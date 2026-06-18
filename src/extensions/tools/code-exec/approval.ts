import {ExtensionContext} from "../../../pi/types";
import {AgentRuntime} from "../../../pi/runtime";
import {
    CodeExecPolicyResult,
    CodeExecPolicyScopeOption,
    PolicyLifetime,
    PolicyResolutionSource,
    PolicyStatus
} from "../../../policy/types";
import {UiDecision, UiDecisionFlowManager, UiFlowShortcut} from "../../shared/ui-flow";
import {UIAiHelpWrap} from "../../shared/ui-flow/DecisionAiHelper";
import {ParsedExecInput} from "./types";

export async function ensureCodeExecAllowed(
    ctx: ExtensionContext,
    runtime: AgentRuntime,
    input: ParsedExecInput,
    denyByDefault: boolean,
): Promise<string | null> {
    let result = runtime.codeExecPolicy.evaluate(input.language, input.mode, denyByDefault);
    if (result === null) {
        result = await askForCodeExecPolicy(ctx, runtime, input);
    }

    if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
    return runtime.codeExecPolicy.toDenyReasonOrNull(result) ?? "Code execution denied.";
}

async function askForCodeExecPolicy(
    ctx: ExtensionContext,
    runtime: AgentRuntime,
    input: ParsedExecInput,
): Promise<CodeExecPolicyResult> {
    const failed = (reason: string): CodeExecPolicyResult => ({
        language: input.language,
        mode: input.mode,
        matchedLanguage: "*",
        matchedMode: "*",
        matchedScope: "(none)",
        matchedLifetime: PolicyLifetime.ONCE,
        matchedStatus: PolicyStatus.DENIED,
        matchedReason: reason,
        resolutionSource: PolicyResolutionSource.SYSTEM,
    });

    if (!ctx.ui || ctx.hasUI === false) {
        return failed(`No code execution policy matched '${input.language} ${input.mode}' and interactive approval is unavailable.`);
    }

    const scopeOptions = runtime.codeExecPolicy.pendingPolicyScopeOptions(input.language, input.mode);
    if (scopeOptions.length === 0) {
        return failed(`No code execution policy scope could be inferred for '${input.language} ${input.mode}'.`);
    }

    const approval = await askCodeExecPolicyWithFlow(ctx, input, scopeOptions);

    const scope = approval.scope;
    const policy = runtime.codeExecPolicy.createPolicyForScope(scope, approval.status, approval.lifetime, approval.reason);

    if (approval.lifetime === PolicyLifetime.ONCE) {
        return {
            language: input.language,
            mode: input.mode,
            matchedLanguage: scope.language,
            matchedMode: scope.mode,
            matchedScope: scope.label,
            matchedLifetime: approval.lifetime,
            matchedStatus: approval.status,
            matchedReason: approval.reason,
            resolutionSource: PolicyResolutionSource.NEW_USER_DECISION,
        };
    }

    runtime.codeExecPolicy.addPolicies([policy]);
    if (approval.lifetime === PolicyLifetime.FOREVER) {
        runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
    }

    const result = runtime.codeExecPolicy.evaluate(input.language, input.mode, true) ?? failed("Code execution policy could not be resolved.");
    return {...result, resolutionSource: PolicyResolutionSource.NEW_USER_DECISION};
}

type CodeExecPolicyApproval = {
    scope: CodeExecPolicyScopeOption;
    status: PolicyStatus;
    lifetime: PolicyLifetime;
    reason: string;
};

async function askCodeExecPolicyWithFlow(
    ctx: ExtensionContext,
    input: ParsedExecInput,
    scopes: CodeExecPolicyScopeOption[],
): Promise<CodeExecPolicyApproval> {
    const target = `${input.language} ${input.mode}`;
    const defaultReason = (status: PolicyStatus) => `User selected ${status} for code execution.`;

    const decisions = {
        scope: {
            type: "select",
            key: "scope",
            title: `Select code execution policy scope for ${target}`,
            showAiHelpOption: true,
            options: scopes.map((scope) => ({title: scope.label, value: scope, next: "status"})),
        },
        status: {
            type: "select",
            key: "status",
            title: `Code execution policy for ${target}`,
            showAiHelpOption: true,
            options: [
                {title: "Allow", value: PolicyStatus.ALLOWED, next: "lifetime"},
                {title: "Deny", value: PolicyStatus.DENIED, next: "lifetime"},
            ],
        },
        lifetime: {
            type: "select",
            key: "lifetime",
            title: "Code execution policy lifetime",
            showAiHelpOption: false,
            options: [PolicyLifetime.ONCE, PolicyLifetime.SESSION, PolicyLifetime.FOREVER].map((lifetime) => ({
                title: lifetime,
                value: lifetime,
                next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null,
            })),
        },
        reason: {
            type: "input",
            key: "reason",
            title: "Reason for denying this code execution policy (optional)",
            placeholder: (state) => defaultReason(state.status ?? PolicyStatus.DENIED),
            next: null,
        },
    } satisfies Record<keyof CodeExecPolicyApproval, UiDecision<CodeExecPolicyApproval>>;

    const fullItem = [
        `Language: ${input.language}`,
        `Args: ${input.args.join(" ") ?? '(none)'}`,
        `Stdin: ${input.stdin ?? '(none)'}`,
        "-----",
        input.source
    ].join("\n")
    const approval = await new UiDecisionFlowManager(ctx).runFlow<CodeExecPolicyApproval>(
        decisions.scope,
        decisions,
        (state) => ({
            scope: state.scope ?? scopes[0],
            status: PolicyStatus.DENIED,
            lifetime: PolicyLifetime.ONCE,
            reason: `Code execution denied: ${codeExecFlowCancelReason(state)}`,
        }),
        new UIAiHelpWrap({
            task: "You explain code execution approval requests. Be concise, neutral, and focus on what would run. Dont explain language, core context is provided alongside your summary",
            fullItem: fullItem,
            subItems: [],
            optionLabel: "ⓘ Explain what this code execution request does before deciding",
        }),
        {enabled: true},
    );

    if (approval === UiFlowShortcut.ALLOW_ALL_ONCE) {
        return {scope: scopes[0], status: PolicyStatus.ALLOWED, lifetime: PolicyLifetime.ONCE, reason: defaultReason(PolicyStatus.ALLOWED)};
    }
    if (approval === UiFlowShortcut.DENY_ALL_ONCE) {
        const reason = await ctx.ui?.input?.(`Reason for denying code execution ${target} (optional)`, defaultReason(PolicyStatus.DENIED));
        return {scope: scopes[0], status: PolicyStatus.DENIED, lifetime: PolicyLifetime.ONCE, reason: reason || defaultReason(PolicyStatus.DENIED)};
    }

    return {...approval, reason: approval.reason || defaultReason(approval.status)};
}

function codeExecFlowCancelReason(state: Partial<CodeExecPolicyApproval>): string {
    if (!state.scope) return "No code execution policy scope selected.";
    if (!state.status) return "No code execution policy decision selected.";
    if (!state.lifetime) return "No code execution policy lifetime selected.";
    return "No code execution policy reason selected.";
}
