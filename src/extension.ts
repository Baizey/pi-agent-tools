import os from "node:os";
import path from "node:path";
import {PiPathPolicy} from "./policy/PiPathPolicy";
import {PathPolicyLogic} from "./policy/path/PathPolicyLogic";
import {PathPolicyLogicStore} from "./policy/path/PathPolicyLogicStore";
import {FsAccessType, PolicyLifetime, PolicyStatus} from "./policy/types";

export type PiExtensionApi = {
    on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallDecision | void> | ToolCallDecision | void): void;
};

type ToolCallEvent = {
    toolName: string;
    input: Record<string, unknown>;
};

type ToolCallDecision = {
    block: true;
    reason: string;
};

type ExtensionContext = {
    cwd: string;
    hasUI?: boolean;
    ui?: {
        select(title: string, items: string[]): Promise<string | undefined>;
    };
};

type PolicyRuntime = {
    policy: PathPolicyLogic;
    store: PathPolicyLogicStore;
};

export default function gantryPolicyExtension(pi: PiExtensionApi): void {
    const runtimes = new Map<string, PolicyRuntime>();

    pi.on("tool_call", async (event, ctx) => {
        const accessType = PiPathPolicy.accessTypeForTool(event.toolName);
        if (!accessType) return;

        const runtime = runtimeFor(ctx.cwd, runtimes);
        for (const candidatePath of pathsForToolCall(event.toolName, event.input)) {
            const result = runtime.policy.evaluate(candidatePath, accessType, false);
            if (result === null) {
                const decision = await askForPolicy(ctx, runtime, candidatePath, accessType);
                if (decision === "allowed") continue;
                return {block: true, reason: decision};
            }
            if (result.matchedStatus === PolicyStatus.ALLOWED) continue;
            return {block: true, reason: runtime.policy.toDenyReasonOrNull(result) ?? "Access denied."};
        }
    });
}

async function askForPolicy(
    ctx: ExtensionContext,
    runtime: PolicyRuntime,
    evaluatedPath: string,
    accessType: FsAccessType,
): Promise<"allowed" | string> {
    if (!ctx.ui || ctx.hasUI === false) {
        return `ACCESS DENIED\nNo policy matched '${evaluatedPath}' and interactive approval is unavailable.`;
    }

    const statusChoice = await ctx.ui.select(
        `No ${accessType} policy for ${evaluatedPath}`,
        ["Allow", "Deny"],
    );
    if (!statusChoice) return "Access denied: no policy decision selected.";

    const lifetimeChoice = await ctx.ui.select(
        "Policy lifetime",
        [PolicyLifetime.ONCE, PolicyLifetime.SESSION, PolicyLifetime.FOREVER],
    );
    if (!lifetimeChoice) return "Access denied: no policy lifetime selected.";

    const scope = await ctx.ui.select(
        "Policy scope",
        pathScopes(evaluatedPath, ctx.cwd),
    );
    if (!scope) return "Access denied: no policy scope selected.";

    const status = statusChoice === "Allow" ? PolicyStatus.ALLOWED : PolicyStatus.DENIED;
    const lifetime = lifetimeChoice as PolicyLifetime;
    const reason = `User selected ${status} for ${accessType}.`;

    if (lifetime !== PolicyLifetime.ONCE) {
        runtime.policy.addPolicies([
            {
                path: scope,
                info: {
                    [accessType]: PathPolicyLogic.createStatus(accessType, lifetime, status, reason),
                },
            },
        ]);
    }

    if (lifetime === PolicyLifetime.FOREVER) runtime.store.save(runtime.policy);
    if (status === PolicyStatus.ALLOWED) return "allowed";
    return `ACCESS DENIED\nUser denied ${accessType} access to '${evaluatedPath}'.`;
}

function runtimeFor(cwd: string, runtimes: Map<string, PolicyRuntime>): PolicyRuntime {
    const key = path.resolve(cwd);
    const existing = runtimes.get(key);
    if (existing) return existing;

    const projectPiDir = path.join(key, ".pi");
    const policy = PiPathPolicy.create({
        cwd: key,
        projectPiDir,
        globalPiDir: path.join(os.homedir(), ".pi", "agent"),
    });
    const store = new PathPolicyLogicStore(path.join(projectPiDir, "path-policy.json"));
    store.loadInto(policy);

    const runtime = {policy, store};
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
    const standardizedCwd = path.resolve(cwd).normalize().replace(/[\\/]+$/g, "");

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
