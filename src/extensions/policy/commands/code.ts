import {AutocompleteItem, PiExtensionApi} from "../../../pi/types";
import {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {CodeExecPolicyMode, PolicyLifetime} from "../../../policy/types";
import {
  clearOptionsError,
  commonCompletions,
  defaultReason,
  err,
  firstAction,
  maybeSavePolicy,
  ok,
  parseCodeMode,
  parseCommonOptions,
  PolicyCommandText,
  tokenizePolicyCommandArgs,
} from "./shared";
import {formatCodeEvaluation, formatCodePoliciesList} from "./display";
import {PolicyCommandAction, PolicyCommandKind, PolicyCommandName, PolicyWildcard, policyStatusForAction} from "./types";

export function registerPolicyCodeCommand(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerCommand?.(PolicyCommandName.CODE, {
    description: "Manage explicit code execution policies.",
    getArgumentCompletions: policyCodeCompletions,
    handler(args, ctx) {
      const runtime = services.runtimeFor(ctx.cwd ?? process.cwd());
      const result = handlePolicyCodeCommand(runtime, args);
      ctx.ui?.notify?.(result.message, result.kind);
    },
  });
}

export function handlePolicyCodeCommand(runtime: AgentRuntime, args: string) {
  const tokens = tokenizePolicyCommandArgs(args);
  const action = firstAction(tokens) ?? (tokens.length === 0 ? PolicyCommandAction.SHOW : null);
  if (!action) return err(`Unknown /${PolicyCommandName.CODE} action: ${tokens[0] ?? ""}`);

  const rest = tokens.slice(action === PolicyCommandAction.SHOW && tokens.length === 0 ? 0 : 1);
  switch (action) {
    case PolicyCommandAction.SHOW:
      return ok(formatCodePolicies(runtime));
    case PolicyCommandAction.EVAL:
      return evalCodePolicy(runtime, rest);
    case PolicyCommandAction.ALLOW:
    case PolicyCommandAction.DENY:
      return addCodePolicy(runtime, action, rest);
    case PolicyCommandAction.REMOVE:
      return removeCodePolicy(runtime, rest);
    case PolicyCommandAction.CLEAR:
      return clearCodePolicies(runtime, rest);
  }
}

export function policyCodeCompletions(prefix: string): AutocompleteItem[] {
  return commonCompletions(prefix, [
    PolicyCommandAction.SHOW,
    PolicyCommandAction.EVAL,
    PolicyCommandAction.ALLOW,
    PolicyCommandAction.DENY,
    PolicyCommandAction.REMOVE,
    PolicyCommandAction.CLEAR,
  ]);
}

function addCodePolicy(runtime: AgentRuntime, action: PolicyCommandAction.ALLOW | PolicyCommandAction.DENY, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [language, rawMode] = options.operands;
  if (!language) return err(PolicyCommandText.MISSING_LANGUAGE);
  if (!rawMode) return err(PolicyCommandText.MISSING_MODE);
  const mode = parseCodeMode(rawMode);
  if (!mode) return err(`Invalid code execution mode: ${rawMode}`);

  const status = policyStatusForAction(action);
  if (!status) return err(`Unsupported /${PolicyCommandName.CODE} action: ${action}`);
  const conflict = sessionWouldShadowForeverCode(runtime, language, mode, options.lifetime);
  if (conflict) return err(conflict);
  const reason = options.reason ?? defaultReason(PolicyCommandName.CODE, action, `${language} ${mode}`);
  runtime.codeExecPolicy.addPolicies([
    runtime.codeExecPolicy.createPolicyForScope({label: `${language} ${mode}`, language, mode}, status, options.lifetime, reason),
  ]);
  maybeSavePolicy(runtime, options.lifetime, PolicyCommandKind.CODE);
  return ok(formatCodePolicies(runtime));
}

function evalCodePolicy(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [language, rawMode] = options.operands;
  if (!language) return err(PolicyCommandText.MISSING_LANGUAGE);
  if (!rawMode) return err(PolicyCommandText.MISSING_MODE);
  const mode = parseCodeMode(rawMode);
  if (!mode || mode === PolicyWildcard.ALL) return err(`Invalid eval code execution mode: ${rawMode}`);

  const result = runtime.codeExecPolicy.evaluate(language, mode, false);
  return ok(formatCodeEvaluation(language, mode, result));
}

function removeCodePolicy(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [language, rawMode] = options.operands;
  if (!language) return err(PolicyCommandText.MISSING_LANGUAGE);
  if (!rawMode) return err(PolicyCommandText.MISSING_MODE);
  const mode = parseCodeMode(rawMode);
  if (!mode) return err(`Invalid code execution mode: ${rawMode}`);

  runtime.codeExecPolicy.removePolicies([{language, mode}]);
  runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
  return ok(formatCodePolicies(runtime));
}

function clearCodePolicies(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const clearError = clearOptionsError(options, 0);
  if (clearError) return err(clearError);
  if (!options.yes) return err(PolicyCommandText.CLEAR_REQUIRES_YES);
  runtime.codeExecPolicy.removePolicies(runtime.codeExecPolicy.policiesSnapshot().map((policy) => ({
    language: policy.language,
    mode: policy.mode,
  })));
  runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
  return ok(formatCodePolicies(runtime));
}

function sessionWouldShadowForeverCode(runtime: AgentRuntime, language: string, mode: CodeExecPolicyMode, lifetime: PolicyLifetime): string | null {
  if (lifetime === PolicyLifetime.FOREVER) return null;
  const normalizedLanguage = normalizeCodeLanguage(language);
  const conflict = runtime.codeExecPolicy.policiesSnapshot().some((policy) =>
    policy.language === normalizedLanguage && policy.mode === mode && policy.lifetime === PolicyLifetime.FOREVER,
  );
  return conflict
    ? "Refusing to shadow forever code policy with a session policy. Remove it first or use --lifetime forever."
    : null;
}

function normalizeCodeLanguage(language: string): string {
  const trimmed = language.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : PolicyWildcard.ALL;
}

export function formatCodePolicies(runtime: AgentRuntime): string {
  return formatCodePoliciesList(runtime.codeExecPolicy.policiesSnapshot());
}
