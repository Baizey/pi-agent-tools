import {ExtensionContext} from "../../../pi/types";
import {AgentRuntime} from "../../../pi/runtime";
import {
    CodeExecMode,
    CodeExecPolicyDeleteRequest,
    CodeExecPolicyResult,
    CodeExecPolicyScopeOption,
    PolicyLifetime,
    PolicyStatus
} from "../../../policy/types";
import {UiDecision, UiDecisionFlowManager} from "../../policy/ui-flow";
import {UIAiHelpOptionInfo, UIAiHelpWrap} from "../../policy/ui-flow/DecisionAiHelper";
import {formatEffectsReport} from "./analysis";
import type {CodeExecEffectsReport} from "../../../policy/types";
import {ParsedExecInput} from "./types";

export type CodeExecApprovalInput = {
    parsed: ParsedExecInput,
    language: string;
    mode: CodeExecMode;
    effectsReport?: CodeExecEffectsReport | null;
    loadEffectsReport?: () => Promise<CodeExecEffectsReport | null>;
    onEffectsReport?: (report: CodeExecEffectsReport | null) => void;
    context?: string | string[];
};

export async function ensureCodeExecAllowed(
    ctx: ExtensionContext,
    runtime: AgentRuntime,
    input: CodeExecApprovalInput,
    denyByDefault: boolean,
): Promise<string | null> {
    const oneShotPolicies: CodeExecPolicyDeleteRequest[] = [];

    try {
        let result = runtime.codeExecPolicy.evaluate(input.language, input.mode, denyByDefault);
        if (result === null) {
            result = await askForCodeExecPolicy(ctx, runtime, input, oneShotPolicies);
        }

        if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
        return runtime.codeExecPolicy.toDenyReasonOrNull(result) ?? "Code execution denied.";
    } finally {
        runtime.codeExecPolicy.removePolicies(oneShotPolicies);
    }
}

async function askForCodeExecPolicy(
    ctx: ExtensionContext,
    runtime: AgentRuntime,
    input: CodeExecApprovalInput,
    oneShotPolicies: CodeExecPolicyDeleteRequest[],
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

    runtime.codeExecPolicy.addPolicies([policy]);
    if (approval.lifetime === PolicyLifetime.ONCE) {
        oneShotPolicies.push({language: scope.language, mode: scope.mode});
    } else if (approval.lifetime === PolicyLifetime.FOREVER) {
        runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
    }

    return runtime.codeExecPolicy.evaluate(input.language, input.mode, true) ?? failed("Code execution policy could not be resolved.");
}

type CodeExecPolicyApproval = {
    scope: CodeExecPolicyScopeOption;
    status: PolicyStatus;
    lifetime: PolicyLifetime;
    reason: string;
};

async function askCodeExecPolicyWithFlow(
    ctx: ExtensionContext,
    input: CodeExecApprovalInput,
    scopes: CodeExecPolicyScopeOption[],
): Promise<CodeExecPolicyApproval> {
    const target = `${input.language} ${input.mode}`;
    const defaultReason = (status: PolicyStatus) => `User selected ${status} for code execution.`;

    const aiHelpInput = {
        task: "",
        fullItem: [
            `Language: ${input.language}`,
            `stdin: ${input.parsed.stdin}`,
            `args: ${input.parsed.args}`,
            `Source: ${input.mode}`,
            `${input.parsed.source}`
        ].join("\n"),
        subItems: []
    } satisfies UIAiHelpOptionInfo
    const effectsHelp = input.loadEffectsReport ? new UIAiHelpWrap(aiHelpInput) : undefined;

    const onCancelReturn = (state: Partial<CodeExecPolicyApproval>): CodeExecPolicyApproval => ({
        scope: state.scope ?? scopes[0],
        status: PolicyStatus.DENIED,
        lifetime: PolicyLifetime.ONCE,
        reason: `Code execution denied: ${codeExecFlowCancelReason(state)}`,
    });

    const scopeDecision = {
        type: "select",
        key: "scope",
        title: () => codeExecTitle(`Select code execution policy scope for ${target}`, input, effectsHelp),
        showAiHelpOption: !!effectsHelp,
        options: scopes.map((scope) => ({
            title: () => scope.label,
            value: scope,
            next: () => "status",
        })),
    } satisfies UiDecision<CodeExecPolicyApproval>;

    const statusDecision = {
        type: "select",
        key: "status",
        title: () => codeExecTitle(`Code execution policy for ${target}`, input, effectsHelp),
        showAiHelpOption: !!effectsHelp,
        options: [
            {title: () => "Allow", value: PolicyStatus.ALLOWED, next: () => "lifetime"},
            {title: () => "Deny", value: PolicyStatus.DENIED, next: () => "lifetime"},
        ],
    } satisfies UiDecision<CodeExecPolicyApproval>;

    const lifetimeDecision = {
        type: "select",
        key: "lifetime",
        title: () => codeExecTitle("Code execution policy lifetime", input, effectsHelp),
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
    } satisfies UiDecision<CodeExecPolicyApproval>;

    const reasonDecision = {
        type: "input",
        key: "reason",
        title: () => codeExecTitle("Reason for denying this code execution policy (optional)", input, effectsHelp),
        placeholder: (state) => defaultReason(state.status ?? PolicyStatus.DENIED),
        next: () => null,
    } satisfies UiDecision<CodeExecPolicyApproval>;

    const approval = await new UiDecisionFlowManager(ctx).runFlow(
        scopeDecision,
        {scope: scopeDecision, status: statusDecision, lifetime: lifetimeDecision, reason: reasonDecision},
        onCancelReturn,
        effectsHelp,
    );

    return {
        ...approval,
        reason: approval.reason || defaultReason(approval.status),
    };
}

function codeExecTitle(title: string, input: CodeExecApprovalInput, effectsHelp?: UIAiHelpWrap): string {
    return [
        title,
        `Approval target: ${input.language} ${input.mode}`,
        `Language: ${input.language}`,
        `Mode: ${input.mode}`,
        ...contextLines(input.context),
        input.effectsReport !== undefined && !effectsHelp ? formatEffectsReport(input.effectsReport) : undefined,
    ].filter(Boolean).join("\n");
}

function codeExecFlowCancelReason(state: Partial<CodeExecPolicyApproval>): string {
    if (!state.scope) return "No code execution policy scope selected.";
    if (!state.status) return "No code execution policy decision selected.";
    if (!state.lifetime) return "No code execution policy lifetime selected.";
    return "No code execution policy reason selected.";
}

function contextLines(context?: string | string[]): string[] {
    if (!context) return [];
    return Array.isArray(context) ? context : [context];
}
