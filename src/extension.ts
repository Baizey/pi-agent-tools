import os from "node:os";
import path from "node:path";
import {PiPathPolicy} from "./policy/PiPathPolicy";
import {PathPolicyLogic} from "./policy/path/PathPolicyLogic";
import {PathPolicyLogicStore} from "./policy/path/PathPolicyLogicStore";
import {FsAccessType, PathPolicyResult, PolicyLifetime, PolicyStatus, ShellPolicy} from "./policy/types";
import {ShellPolicyLogic} from "./policy/shell/ShellPolicyLogic";
import {ShellPolicyLogicStore} from "./policy/shell/ShellPolicyLogicStore";

export type PiExtensionApi = {
    on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallDecision | void> | ToolCallDecision | void): void;
    on(event: "user_bash", handler: (event: UserBashEvent, ctx: ExtensionContext) => Promise<UserBashDecision | void> | UserBashDecision | void): void;
    registerTool?(definition: ToolDefinition): void;
};

type ToolCallEvent = {
    toolName: string;
    input: Record<string, unknown>;
};

type ToolCallDecision = {
    block: true;
    reason: string;
};

type ToolDefinition = {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(
        toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
        onUpdate?: unknown,
        ctx?: ExtensionContext,
    ): Promise<{
        content: Array<{ type: "text"; text: string }>;
        details?: Record<string, unknown>;
        isError?: boolean
    }>;
};

type UserBashEvent = {
    command: string;
    cwd: string;
    excludeFromContext: boolean;
};

type UserBashDecision = {
    result: {
        output: string;
        exitCode: number;
        cancelled: boolean;
        truncated: boolean;
    };
};

type ExtensionContext = {
    cwd: string;
    hasUI?: boolean;
    ui?: {
        select(title: string, items: string[]): Promise<string | undefined>;
    };
};

type PolicyRuntime = {
    pathPolicy: PathPolicyLogic;
    pathPolicyStore: PathPolicyLogicStore;
    shellPolicy: ShellPolicyLogic;
    shellPolicyStore: ShellPolicyLogicStore;
};

export default function gantryPolicyExtension(pi: PiExtensionApi): void {
    const runtimes = new Map<string, PolicyRuntime>();
    pi.on("tool_call", async (event, ctx) => {
        const runtime = runtimeFor(ctx.cwd, runtimes);
        const accessType = PiPathPolicy.accessTypeForTool(event.toolName);
        if (!accessType) return;
        for (const candidatePath of pathsForToolCall(event.toolName, event.input)) {
            const reason = await ensurePathAllowed(ctx, runtime, candidatePath, accessType, false);
            if (reason) return {block: true, reason};
        }
    });

    pi.on("tool_call", async (event, ctx) => {
            if (event.toolName !== "bash") return;
            const runtime = runtimeFor(ctx.cwd, runtimes);
            const command = (event.input.command || "") as string
            const result = runtime.shellPolicy.evaluate(command)
            const response = runtime.shellPolicy.toDenyReasonOrNull(result)
            if (response) return {block: true, reason: response}
        }
    )
}

async function ensurePathAllowed(
    ctx: ExtensionContext,
    runtime: PolicyRuntime,
    candidatePath: string,
    accessType: FsAccessType,
    denyByDefault: boolean,
): Promise<string | null> {
    let result = runtime.pathPolicy.evaluate(candidatePath, accessType, denyByDefault);
    if (result === null) {
        result = await askForPolicy(ctx, runtime, standardizePath(ctx.cwd, candidatePath), accessType)
    }
    if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
    return runtime.pathPolicy.toDenyReasonOrNull(result) ?? "Access denied.";
}

async function askForPolicy(
    ctx: ExtensionContext,
    runtime: PolicyRuntime,
    evaluatedPath: string,
    accessType: FsAccessType,
): Promise<PathPolicyResult> {
    const failed: (reason: string) => PathPolicyResult =
        (reason: string) => {
            return {
                evaluatedPath,
                evaluatedAccessType: accessType,
                matchedPattern: '(none)',
                matchedLifetime: PolicyLifetime.ONCE,
                matchedStatus: PolicyStatus.DENIED,
                matchedReason: reason,
            } satisfies PathPolicyResult
        };

    if (!ctx.ui || ctx.hasUI === false) {
        return failed(`No policy matched '${evaluatedPath}' and interactive approval is unavailable.`);
    }

    const statusChoice = await ctx.ui.select(
        `No ${accessType} policy for ${evaluatedPath}`,
        ["Allow", "Deny"],
    );
    if (!statusChoice) return failed(`Access denied: no policy decision selected.`);

    const lifetimeChoice = await ctx.ui.select(
        "Policy lifetime",
        [PolicyLifetime.ONCE, PolicyLifetime.SESSION, PolicyLifetime.FOREVER],
    );
    if (!lifetimeChoice) return failed(`Access denied: no policy lifetime selected.`);

    const scope = await ctx.ui.select(
        "Policy scope",
        pathScopes(evaluatedPath, ctx.cwd),
    );
    if (!scope) return failed(`Access denied: no policy scope selected.`);

    const status = statusChoice === "Allow" ? PolicyStatus.ALLOWED : PolicyStatus.DENIED;
    const lifetime = lifetimeChoice as PolicyLifetime;
    const reason = `User selected ${status} for ${accessType}.`;

    if (lifetime !== PolicyLifetime.ONCE) {
        runtime.pathPolicy.addPolicies([
            {
                path: scope,
                info: {
                    [accessType]: PathPolicyLogic.createStatus(accessType, lifetime, status, reason),
                },
            },
        ]);
        if (lifetime === PolicyLifetime.FOREVER) {
            runtime.pathPolicyStore.save(runtime.pathPolicy);
        }
    }
    return {
        evaluatedPath,
        evaluatedAccessType: accessType,
        matchedPattern: scope,
        matchedLifetime: lifetime,
        matchedStatus: status,
        matchedReason: reason,
    } satisfies PathPolicyResult;
}

function runtimeFor(cwd: string, runtimes: Map<string, PolicyRuntime>): PolicyRuntime {
    const key = path.resolve(cwd);
    const existing = runtimes.get(key);
    if (existing) return existing;

    const projectPiDir = path.join(key, ".pi");
    const userPiDir = path.join(os.homedir(), ".pi", "agent");

    const pathPolicy = PiPathPolicy.create({
        cwd: key,
        projectPiDir,
        globalPiDir: userPiDir,
    });
    const pathPolicyStore = new PathPolicyLogicStore(path.join(userPiDir, "path-policy.json"));
    const shellPolicy = new ShellPolicyLogic()
    const shellPolicyStore = new ShellPolicyLogicStore(path.join(userPiDir, "shell-policy.json"));
    pathPolicyStore.loadInto(pathPolicy);

    const runtime: PolicyRuntime = {
        pathPolicy: pathPolicy,
        pathPolicyStore: pathPolicyStore,
        shellPolicy: shellPolicy,
        shellPolicyStore: shellPolicyStore
    };
    runtimes.set(key, runtime);
    return runtime;
}

function pathsForToolCall(toolName: string, input: Record<string, unknown>): string[] {
    switch (toolName) {
        case "read":
        case "write":
        case "ls":
        case "edit":
            return stringValues(input.path);

        case "grep":
        case "find":
            return stringValues(input.path ?? input.directory ?? input.cwd ?? ".");

        case 'bash':
            return stringValues(input.cwd ?? '.');

        default:
            return [];
    }
}

function pathScopes(evaluatedPath: string, cwd: string): string[] {
    const scopes: string[] = [];
    let current = evaluatedPath;
    const root = path.parse(current).root;
    const standardizedCwd = standardizePath(cwd, ".");

    while (true) {
        scopes.push(current);
        if (current === standardizedCwd || current === root) break;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    return scopes;
}

function stringValues(value: unknown): string[] {
    if (typeof value === "string" && value.trim()) return [value];
    if (Array.isArray(value)) return value.flatMap(stringValues);
    return [];
}

function standardizePath(cwd: string, input: string): string {
    return path.resolve(cwd, input).normalize().replace(/[\\/]+$/g, "");
}
