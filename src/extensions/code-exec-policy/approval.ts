import {ExtensionContext} from "../../pi/types";
import {AgentRuntime} from "../../pi/runtime";
import {CodeExecMode, CodeExecPolicyDeleteRequest, CodeExecPolicyResult, PolicyLifetime, PolicyStatus} from "../../policy/types";
import {formatEffectsReport} from "./analysis";
import type {CodeExecEffectsReport} from "../../policy/types";

export async function ensureCodeExecAllowed(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  input: {language: string; mode: CodeExecMode; effectsReport?: CodeExecEffectsReport | null},
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
  input: {language: string; mode: CodeExecMode; effectsReport?: CodeExecEffectsReport | null},
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

  const scopeChoice = await ctx.ui.select(
    `Select code execution policy scope for ${input.language} ${input.mode}\n${formatEffectsReport(input.effectsReport ?? null)}`,
    scopeOptions.map((option) => option.label),
  );
  if (!scopeChoice) return failed("No code execution policy scope selected.");

  const scope = scopeOptions.find((option) => option.label === scopeChoice) ?? scopeOptions[0];
  const statusChoice = await ctx.ui.select(
    `Code execution policy for ${scope.label}\n${formatEffectsReport(input.effectsReport ?? null)}`,
    ["Allow", "Deny"],
  );
  if (!statusChoice) return failed("No code execution policy decision selected.");

  const lifetimeChoice = await ctx.ui.select("Code execution policy lifetime", [
    PolicyLifetime.ONCE,
    PolicyLifetime.SESSION,
    PolicyLifetime.FOREVER,
  ]);
  if (!lifetimeChoice) return failed("No code execution policy lifetime selected.");

  const status = statusChoice === "Allow" ? PolicyStatus.ALLOWED : PolicyStatus.DENIED;
  const lifetime = lifetimeChoice as PolicyLifetime;
  const defaultReason = `User selected ${status} for code execution.`;
  const reason = status === PolicyStatus.DENIED ? await askForDenyReason(ctx, defaultReason) : defaultReason;
  const policy = runtime.codeExecPolicy.createPolicyForScope(scope, status, lifetime, reason);

  runtime.codeExecPolicy.addPolicies([policy]);
  if (lifetime === PolicyLifetime.ONCE) {
    oneShotPolicies.push({language: scope.language, mode: scope.mode});
  } else if (lifetime === PolicyLifetime.FOREVER) {
    runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
  }

  return runtime.codeExecPolicy.evaluate(input.language, input.mode, true) ?? failed("Code execution policy could not be resolved.");
}

async function askForDenyReason(ctx: ExtensionContext, defaultReason: string): Promise<string> {
  if (!ctx.ui?.input) return defaultReason;
  const reason = await ctx.ui.input("Reason for denying this code execution policy (optional)", defaultReason);
  const trimmed = reason?.trim();
  return trimmed ? trimmed : defaultReason;
}
