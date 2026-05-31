import os from "node:os";
import path from "node:path";
import {PiPathPolicy} from "./policy/PiPathPolicy";
import {PathPolicyLogic} from "./policy/path/PathPolicyLogic";
import {PathPolicyLogicStore} from "./policy/path/PathPolicyLogicStore";
import {FsAccessType, PathPolicyResult, PolicyLifetime, PolicyStatus} from "./policy/types";
import {brokerAccessType, WindowsBrokerRunner} from "./shell/WindowsBrokerRunner";

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
    ): Promise<{ content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown>; isError?: boolean }>;
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
};

export default function gantryPolicyExtension(pi: PiExtensionApi): void {
    const runtimes = new Map<string, PolicyRuntime>();
    const broker = new WindowsBrokerRunner();

    pi.registerTool?.({
        name: "bash",
        label: "Bash",
        description: "Execute a shell command through the Pi.dev Windows path policy broker.",
        parameters: {
            type: "object",
            properties: {
                command: {type: "string", description: "Shell command to run."},
                timeout: {type: "number", description: "Optional timeout in milliseconds."},
            },
            required: ["command"],
            additionalProperties: false,
        },
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const command = typeof params.command === "string" ? params.command : "";
            const cwd = ctx?.cwd ?? process.cwd();
            const timeoutMs = typeof params.timeout === "number" ? params.timeout : undefined;

            if (!command.trim()) {
                return {content: [{type: "text", text: "Missing command."}], isError: true};
            }

            const result = await runBrokeredCommand(ctx ?? {cwd}, broker, runtimes, command, cwd, timeoutMs);
            return {
                content: [{type: "text", text: result.output}],
                details: result,
                isError: result.exitCode !== 0,
            };
        },
    });

    pi.on("tool_call", async (event, ctx) => {
        const runtime = runtimeFor(ctx.cwd, runtimes);
        const accessType = PiPathPolicy.accessTypeForTool(event.toolName);
        if (!accessType) return;
        for (const candidatePath of pathsForToolCall(event.toolName, event.input)) {
            const reason = await ensurePathAllowed(ctx, runtime, candidatePath, accessType, false);
            if (reason) return {block: true, reason};
        }
    });

    pi.on("user_bash", async (event, ctx) => {
        const cwd = event.cwd || ctx.cwd;
        return {result: await runBrokeredCommand(ctx, broker, runtimes, event.command, cwd)};
    });
}

async function runBrokeredCommand(
    ctx: ExtensionContext,
    broker: WindowsBrokerRunner,
    runtimes: Map<string, PolicyRuntime>,
    command: string,
    cwd: string,
    timeoutMs?: number,
): Promise<UserBashDecision["result"]> {
    const runtime = runtimeFor(cwd, runtimes);
    return broker.run({
        command,
        cwd,
        timeoutMs,
        onAccessRequest: async (request) => {
            const accessType = brokerAccessType(request.accessType);
            if (!accessType) {
                return {allowed: false, reason: `Unknown broker access type: ${request.accessType}`};
            }

            const reason = await ensurePathAllowed({...ctx, cwd}, runtime, request.path, accessType, false);
            return {allowed: reason === null, reason: reason ?? undefined};
        },
    });
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

    if (lifetime === PolicyLifetime.FOREVER) runtime.pathPolicyStore.save(runtime.pathPolicy);
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
    pathPolicyStore.loadInto(pathPolicy);

    const runtime: PolicyRuntime = {pathPolicy, pathPolicyStore};
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
