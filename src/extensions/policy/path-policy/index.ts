import path from "node:path";
import {PiExtensionApi, ExtensionContext} from "../../../pi/types";
import {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {PathPolicyLogic} from "../../../policy/path/PathPolicyLogic";
import {FsAccessType, PathPolicyResult, PolicyLifetime, PolicyStatus} from "../../../policy/types";
import {agentEnv, isAgentEnvEnabled} from "../../../shared/env";
import {standardizePath} from "../../../shared/paths";
import {toolNames} from "../../../shared/toolNames";
import {UiDecision, UiDecisionFlowManager} from "../../shared/ui-flow";
import {stringValues} from "../../../shared/values";

export function registerPathPolicy(pi: PiExtensionApi, services: AgentServices): void {
    pi.on("tool_call", async (event, ctx) => {
        const pathAccesses = pathAccessesForToolCall(event.toolName, event.input);
        if (pathAccesses.length === 0) return;

        const runtime = services.runtimeFor(ctx.cwd);
        for (const pathAccess of pathAccesses) {
            const reason = await ensurePathAllowed(
                ctx,
                runtime,
                pathAccess.path,
                pathAccess.accessType,
                isAgentEnvEnabled(agentEnv.pathDenyByDefault),
            );
            if (reason) return {block: true, reason};
        }
    });
}

export async function ensurePathAllowed(
    ctx: ExtensionContext,
    runtime: AgentRuntime,
    candidatePath: string,
    accessType: FsAccessType,
    denyByDefault: boolean,
): Promise<string | null> {
    let result = runtime.pathPolicy.evaluate(candidatePath, accessType, denyByDefault);
    if (result === null) {
        result = await askForPolicy(ctx, runtime, standardizePath(ctx.cwd, candidatePath), accessType);
    }

    if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
    return runtime.pathPolicy.toDenyReasonOrNull(result) ?? "Access denied.";
}

async function askForPolicy(
    ctx: ExtensionContext,
    runtime: AgentRuntime,
    evaluatedPath: string,
    accessType: FsAccessType,
): Promise<PathPolicyResult> {
    const failed = (reason: string): PathPolicyResult => ({
        evaluatedPath,
        evaluatedAccessType: accessType,
        matchedPattern: "(none)",
        matchedLifetime: PolicyLifetime.ONCE,
        matchedStatus: PolicyStatus.DENIED,
        matchedReason: reason,
    });

    if (!ctx.ui || ctx.hasUI === false) {
        return failed(`No policy matched '${evaluatedPath}' and interactive approval is unavailable.`);
    }

    const approval = await askPathPolicyWithFlow(ctx, evaluatedPath, accessType, pathScopes(evaluatedPath, ctx.cwd));

    if (approval.lifetime !== PolicyLifetime.ONCE) {
        runtime.pathPolicy.addPolicies([
            {
                path: approval.scope,
                info: {
                    [accessType]: PathPolicyLogic.createStatus(accessType, approval.lifetime, approval.status, approval.reason),
                },
            },
        ]);

        if (approval.lifetime === PolicyLifetime.FOREVER) {
            runtime.pathPolicyStore.save(runtime.pathPolicy);
        }
    }

    return {
        evaluatedPath,
        evaluatedAccessType: accessType,
        matchedPattern: approval.scope,
        matchedLifetime: approval.lifetime,
        matchedStatus: approval.status,
        matchedReason: approval.reason,
    };
}

type PathPolicyApproval = {
    scope: string;
    status: PolicyStatus;
    lifetime: PolicyLifetime;
    reason: string;
};

async function askPathPolicyWithFlow(
    ctx: ExtensionContext,
    evaluatedPath: string,
    accessType: FsAccessType,
    scopes: string[],
): Promise<PathPolicyApproval> {
    const defaultReason = (status: PolicyStatus) => `User selected ${status} for ${accessType}.`;
    const onCancelReturn = (state: Partial<PathPolicyApproval>): PathPolicyApproval => ({
        scope: state.scope ?? "(none)",
        status: PolicyStatus.DENIED,
        lifetime: PolicyLifetime.ONCE,
        reason: `Access denied: ${pathFlowCancelReason(state, evaluatedPath)}`,
    });

    const scopeDecision = {
        type: "select",
        key: "scope",
        title: () => [
            `Policy scope for ${accessType} ${evaluatedPath}`,
        ].join("\n"),
        showAiHelpOption: false,
        options: scopes.map((scope) => ({
            title: () => scope,
            value: scope,
            next: () => "status",
        })),
    } satisfies UiDecision<PathPolicyApproval>;

    const statusDecision = {
        type: "select",
        key: "status",
        title: () => [
            `Policy status`,
            `Approval target: ${accessType} ${evaluatedPath}`,
        ].join('\n'),
        showAiHelpOption: false,
        options: [
            {title: () => "Allow", value: PolicyStatus.ALLOWED, next: () => "lifetime"},
            {title: () => "Deny", value: PolicyStatus.DENIED, next: () => "lifetime"},
        ],
    } satisfies UiDecision<PathPolicyApproval>;

    const lifetimeDecision = {
        type: "select",
        key: "lifetime",
        title: () => [
            `Policy lifetime`,
            `Approval target: ${accessType} ${evaluatedPath}`,
        ].join('\n'),
        showAiHelpOption: false,
        options: [
            {
                title: () => PolicyLifetime.ONCE,
                value: PolicyLifetime.ONCE,
                next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null
            },
            {
                title: () => PolicyLifetime.SESSION,
                value: PolicyLifetime.SESSION,
                next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null
            },
            {
                title: () => PolicyLifetime.FOREVER,
                value: PolicyLifetime.FOREVER,
                next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null
            },
        ],
    } satisfies UiDecision<PathPolicyApproval>;

    const reasonDecision = {
        type: "input",
        key: "reason",
        title: () => [
            `Reason for denying this policy (optional)`,
            `Approval target: ${accessType} ${evaluatedPath}`,
        ].join('\n'),
        placeholder: (state) => defaultReason(state.status ?? PolicyStatus.DENIED),
        next: () => null,
    } satisfies UiDecision<PathPolicyApproval>;

    const approval = await new UiDecisionFlowManager(ctx).runFlow(
        scopeDecision,
        {
            scope: scopeDecision,
            status: statusDecision,
            lifetime: lifetimeDecision,
            reason: reasonDecision,
        },
        onCancelReturn,
    );

    return {
        ...approval,
        reason: approval.reason || defaultReason(approval.status),
    };
}

function pathFlowCancelReason(state: Partial<PathPolicyApproval>, evaluatedPath: string): string {
    if (!state.scope) return `No path policy scope selected for '${evaluatedPath}'.`;
    if (!state.status) return "No path policy decision selected.";
    if (!state.lifetime) return "No path policy lifetime selected.";
    return "No path policy reason selected.";
}

type PathAccess = {
    path: string;
    accessType: FsAccessType;
};

function pathAccessesForToolCall(toolName: string, input: Record<string, unknown>): PathAccess[] {
    switch (toolName) {
        case toolNames.read:
        case toolNames.stat:
            return accesses(input.path, FsAccessType.READ);

        case toolNames.write:
        case toolNames.mkdir:
            return accesses(input.path, FsAccessType.WRITE);

        case toolNames.edit:
            return accesses(input.path, FsAccessType.EDIT);

        case toolNames.delete:
            return accesses(input.path, FsAccessType.DELETE);

        case toolNames.copy:
            return [
                ...accesses(input.from, FsAccessType.READ),
                ...accesses(input.to, FsAccessType.WRITE),
            ];

        case toolNames.move:
            return [
                ...accesses(input.from, FsAccessType.DELETE),
                ...accesses(input.to, FsAccessType.WRITE),
                ...(input.overwrite === true ? accesses(input.to, FsAccessType.DELETE) : []),
            ];

        default:
            return [];
    }
}

function accesses(value: unknown, accessType: FsAccessType): PathAccess[] {
    return stringValues(value).map((path) => ({path, accessType}));
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
