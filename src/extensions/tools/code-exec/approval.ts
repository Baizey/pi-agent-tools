import {ExtensionContext} from "../../../pi/types";
import {AgentRuntime} from "../../../pi/runtime";
import {CodeExecMode, CodeExecPolicyDeleteRequest, CodeExecPolicyResult, PolicyLifetime, PolicyStatus} from "../../../policy/types";
import {askPolicyApproval, isPolicyApprovalFailure} from "../../shared/policy-approval";
import {formatEffectsReport} from "./analysis";
import type {CodeExecEffectsReport} from "../../../policy/types";

export async function ensureCodeExecAllowed(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  input: {
    language: string;
    mode: CodeExecMode;
    effectsReport?: CodeExecEffectsReport | null;
    loadEffectsReport?: () => Promise<CodeExecEffectsReport | null>;
    onEffectsReport?: (report: CodeExecEffectsReport | null) => void;
    context?: string | string[];
  },
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
  input: {
    language: string;
    mode: CodeExecMode;
    effectsReport?: CodeExecEffectsReport | null;
    loadEffectsReport?: () => Promise<CodeExecEffectsReport | null>;
    onEffectsReport?: (report: CodeExecEffectsReport | null) => void;
    context?: string | string[];
  },
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

  let effectsReport = input.effectsReport;
  const approval = await askPolicyApproval(ctx, {
    policyKind: "code execution",
    target: `${input.language} ${input.mode}`,
    scopes: scopeOptions.map((scope) => ({label: scope.label, value: scope})),
    intro: effectsReport === undefined ? undefined : formatEffectsReport(effectsReport),
    context: [
      `Language: ${input.language}`,
      `Mode: ${input.mode}`,
      ...contextLines(input.context),
    ],
    contextOptionLabel: "ⓘ Analyze likely effects and inferred path access before deciding",
    loadContext: input.loadEffectsReport
      ? async () => {
        effectsReport = await input.loadEffectsReport?.() ?? null;
        input.onEffectsReport?.(effectsReport);
        return {intro: formatEffectsReport(effectsReport)};
      }
      : undefined,
    defaultReason: (status) => `User selected ${status} for code execution.`, 
  });
  if (isPolicyApprovalFailure(approval)) return failed(approval.deniedReason);

  const scope = approval.scope.value;
  const policy = runtime.codeExecPolicy.createPolicyForScope(scope, approval.status, approval.lifetime, approval.reason);

  runtime.codeExecPolicy.addPolicies([policy]);
  if (approval.lifetime === PolicyLifetime.ONCE) {
    oneShotPolicies.push({language: scope.language, mode: scope.mode});
  } else if (approval.lifetime === PolicyLifetime.FOREVER) {
    runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
  }

  return runtime.codeExecPolicy.evaluate(input.language, input.mode, true) ?? failed("Code execution policy could not be resolved.");
}

function contextLines(context?: string | string[]): string[] {
  if (!context) return [];
  return Array.isArray(context) ? context : [context];
}
