import os from "node:os";
import type {ExtensionContext} from "../../../pi/types";
import type {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {FsAccessType} from "../../../policy/types";
import {AgentEnvName, isAgentEnvEnabled} from "../../../shared/env";
import {errorResult, successResult, TextToolResult} from "../../../shared/toolResults";
import {ensurePathAllowed} from "../../policy/path-policy";
import {ensureCodeExecAllowed} from "./approval";
import {PlanningCleanupError} from "./adapters";
import type {ProcessResult} from "./process";
import {runProcess} from "./process";
import {formatProcessOutcome, withCleanupFailure} from "./resultFormatting";
import {CodeExecRuntimeRegistry} from "./runtimeRegistry";
import {
    Adapter,
    CodeExecMode,
    ExecutionPlan,
    isDetectedRuntime,
    ParsedExecInput,
    RuntimeInfo,
    TempArtifactMode
} from "./types";

export type WorkflowRegistry = Pick<CodeExecRuntimeRegistry, "adapterFor" | "detect">;
export type WorkflowProcessRunner = (
    proc: { command: string; args: string[]; cwd: string },
    stdin: string | undefined,
    timeoutSeconds: number,
    signal?: AbortSignal,
) => Promise<ProcessResult>;

export type CodeExecWorkflowDependencies = {
    registry: WorkflowRegistry;
    runProcess: WorkflowProcessRunner;
    now: () => number;
    tempPath: () => string;
    runtimeFor: (cwd: string) => AgentRuntime;
    ensurePath: (ctx: ExtensionContext, runtime: AgentRuntime, path: string, access: FsAccessType) => Promise<string | null>;
    ensureCode: (ctx: ExtensionContext, runtime: AgentRuntime, input: ParsedExecInput) => Promise<string | null>;
};

export function createCodeExecWorkflowDependencies(
    services: AgentServices,
    registry: WorkflowRegistry,
): CodeExecWorkflowDependencies {
    const pathDenyByDefault = isAgentEnvEnabled(AgentEnvName.pathDenyByDefault);
    const codeDenyByDefault = isAgentEnvEnabled(AgentEnvName.codeExecDenyByDefault);
    return {
        registry,
        runProcess,
        now: () => performance.now(),
        tempPath: () => os.tmpdir(),
        runtimeFor: (cwd) => services.runtimeFor(cwd),
        ensurePath: (ctx, runtime, path, access) => ensurePathAllowed(ctx, runtime, path, access, pathDenyByDefault),
        ensureCode: (ctx, runtime, input) => ensureCodeExecAllowed(ctx, runtime, input, codeDenyByDefault),
    };
}

/** Executes an already parsed request. Parsing deliberately remains outside the security workflow. */
export async function executeCodeWorkflow(
    input: ParsedExecInput,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    dependencies: CodeExecWorkflowDependencies,
): Promise<TextToolResult> {
    if (signal?.aborted) return cancelledResult();

    const runtime = dependencies.runtimeFor(input.cwd);
    const cwdDenied = await dependencies.ensurePath(ctx, runtime, input.cwd, FsAccessType.EXECUTE);
    if (signal?.aborted) return cancelledResult();
    if (cwdDenied) return blockedResult(cwdDenied);

    if (input.mode === CodeExecMode.FILE) {
        const readDenied = await dependencies.ensurePath(ctx, runtime, input.source, FsAccessType.READ);
        if (signal?.aborted) return cancelledResult();
        if (readDenied) return blockedResult(readDenied);
        const executeDenied = await dependencies.ensurePath(ctx, runtime, input.source, FsAccessType.EXECUTE);
        if (signal?.aborted) return cancelledResult();
        if (executeDenied) return blockedResult(executeDenied);
    }

    const codeDenied = await dependencies.ensureCode(ctx, runtime, input);
    if (signal?.aborted) return cancelledResult();
    if (codeDenied) return blockedResult(codeDenied);

    const adapter = dependencies.registry.adapterFor(input.language);
    let runtimeInfo: RuntimeInfo;
    try {
        runtimeInfo = await dependencies.registry.detect(input.language);
    } catch (error) {
        if (signal?.aborted) return cancelledResult();
        return errorResult(`Runtime detection failed for ${input.language}: ${errorMessage(error)}`);
    }
    if (signal?.aborted) return cancelledResult({runtime: runtimeInfo});
    if (!isDetectedRuntime(runtimeInfo)) return errorResult(`Runtime unavailable for ${input.language}: ${runtimeInfo.error ?? "not found"}`, {runtime: runtimeInfo});
    if (!runtimeInfo.modes.includes(input.mode)) return errorResult(`${input.language} does not support ${input.mode} execution.`, {runtime: runtimeInfo});

    const tempDenied = await authorizeTempArtifacts(input.mode, adapter, ctx, runtime, dependencies, signal);
    if (tempDenied.cancelled) return cancelledResult({runtime: runtimeInfo});
    if (tempDenied.reason) return blockedResult(tempDenied.reason);
    if (signal?.aborted) return cancelledResult({runtime: runtimeInfo});

    let plan: ExecutionPlan;
    try {
        plan = await adapter.plan(input, runtimeInfo);
    } catch (error) {
        if (signal?.aborted) {
            const cancelled = cancelledResult({runtime: runtimeInfo});
            return error instanceof PlanningCleanupError
                ? withCleanupFailure(cancelled, errorMessage(error.cleanupError))
                : cancelled;
        }
        return errorResult(`Code execution planning failed: ${errorMessage(error)}`, {runtime: runtimeInfo});
    }

    let primary: TextToolResult;
    try {
        primary = signal?.aborted
            ? cancelledResult(executionDetails(plan.runtime))
            : await executePlan(plan, input, signal, dependencies);
    } catch (error) {
        primary = errorResult(`Code execution failed: ${errorMessage(error)}`, executionDetails(plan.runtime));
    }

    let cleanupError: string | undefined;
    try {
        await plan.cleanup?.();
    } catch (error) {
        cleanupError = errorMessage(error);
    }
    return cleanupError ? withCleanupFailure(primary, cleanupError) : primary;
}

async function executePlan(
    plan: ExecutionPlan,
    input: ParsedExecInput,
    signal: AbortSignal | undefined,
    dependencies: CodeExecWorkflowDependencies,
): Promise<TextToolResult> {
    const deadline = dependencies.now() + input.timeoutSeconds * 1000;
    let compile: ProcessResult | undefined;

    if (signal?.aborted) return cancelledResult(executionDetails(plan.runtime));
    if (plan.compile) {
        const remaining = deadline - dependencies.now();
        if (remaining <= 0) {
            compile = syntheticResult({timedOut: true});
            return processResult("compile", compile, plan.runtime, compile, undefined);
        }
        compile = await dependencies.runProcess(plan.compile, undefined, remaining / 1000, signal);
        if (compile.cancelled || compile.timedOut || compile.spawnError || compile.stdinError || compile.exitCode !== 0) {
            return processResult("compile", compile, plan.runtime, compile, undefined);
        }
        if (signal?.aborted) return cancelledResult(executionDetails(plan.runtime, compile));
    }

    if (signal?.aborted) return cancelledResult(executionDetails(plan.runtime, compile));
    const remaining = deadline - dependencies.now();
    if (remaining <= 0) {
        const run = syntheticResult({timedOut: true});
        return processResult("run", run, plan.runtime, compile, run);
    }
    const run = await dependencies.runProcess(plan.run, input.stdin, remaining / 1000, signal);
    return processResult("run", run, plan.runtime, compile, run);
}

function processResult(
    stage: "compile" | "run",
    result: ProcessResult,
    runtime: RuntimeInfo,
    compile: ProcessResult | undefined,
    run: ProcessResult | undefined,
): TextToolResult {
    const formatted = formatProcessOutcome(stage, result);
    return successResult(formatted.text, executionDetails(runtime, compile, run), formatted.isError);
}

async function authorizeTempArtifacts(
    mode: CodeExecMode,
    adapter: Adapter,
    ctx: ExtensionContext,
    runtime: AgentRuntime,
    dependencies: CodeExecWorkflowDependencies,
    signal?: AbortSignal,
): Promise<{ reason?: string; cancelled?: boolean }> {
    const needed = adapter.tempArtifacts === TempArtifactMode.ALWAYS
        || (adapter.tempArtifacts === TempArtifactMode.INLINE && mode === CodeExecMode.INLINE);
    if (!needed) return {};

    const tempRoot = dependencies.tempPath();
    for (const access of [FsAccessType.WRITE, FsAccessType.READ, FsAccessType.EXECUTE]) {
        const reason = await dependencies.ensurePath(ctx, runtime, tempRoot, access);
        if (signal?.aborted) return {cancelled: true};
        if (reason) return {reason: `Code execution needs temporary ${adapter.language} artifacts under ${tempRoot}.\nAccess: ${access}\n\n${reason}`};
    }
    return {};
}

function executionDetails(runtime: RuntimeInfo, compile?: ProcessResult, run?: ProcessResult): Record<string, unknown> {
    return {runtime, compile: compile ?? null, run: run ?? null};
}

function blockedResult(reason: string): TextToolResult {
    return errorResult(reason, {blocked: true});
}

function cancelledResult(details: Record<string, unknown> = {}): TextToolResult {
    return errorResult("Code execution cancelled.", details);
}

function syntheticResult(overrides: Partial<ProcessResult>): ProcessResult {
    return {stdout: "", stderr: "", exitCode: null, timedOut: false, cancelled: false, ...overrides};
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
