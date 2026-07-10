import {AutocompleteItem, PiExtensionApi} from "../../../pi/types";
import {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {
  clearOptionsError,
  clearPolicyKind,
  commonCompletions,
  err,
  firstAction,
  firstKind,
  ok,
  parseCommonOptions,
  PolicyCommandText,
  tokenizePolicyCommandArgs,
} from "./shared";
import {formatCodePolicies} from "./code";
import {formatIoPolicies} from "./io";
import {formatShellPolicies} from "./shell";
import {formatWebPolicies} from "./web";
import {PolicyCommandAction, PolicyCommandKind, PolicyCommandName, policyCommandKinds} from "./types";
import {formatPolicySections} from "./display";

export function registerPolicyCommand(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerCommand?.(PolicyCommandName.POLICY, {
    description: "Show or clear explicit policies across policy kinds.",
    getArgumentCompletions: policyCommandCompletions,
    handler(args, ctx) {
      const runtime = services.runtimeFor(ctx.cwd ?? process.cwd());
      const result = handlePolicyCommand(runtime, args);
      ctx.ui?.notify?.(result.message, result.kind);
    },
  });
}

export function handlePolicyCommand(runtime: AgentRuntime, args: string) {
  const tokens = tokenizePolicyCommandArgs(args);
  const action = firstAction(tokens) ?? (tokens.length === 0 ? PolicyCommandAction.SHOW : null);
  if (!action) return err(`Unknown /${PolicyCommandName.POLICY} action: ${tokens[0] ?? ""}`);

  const rest = tokens.slice(action === PolicyCommandAction.SHOW && tokens.length === 0 ? 0 : 1);
  switch (action) {
    case PolicyCommandAction.SHOW:
      return showPolicies(runtime, rest);
    case PolicyCommandAction.CLEAR:
      return clearPolicies(runtime, rest);
    case PolicyCommandAction.EVAL:
    case PolicyCommandAction.ALLOW:
    case PolicyCommandAction.DENY:
    case PolicyCommandAction.REMOVE:
      return err(`Use /${PolicyCommandName.IO}, /${PolicyCommandName.SHELL}, /${PolicyCommandName.CODE}, or /${PolicyCommandName.WEB} for ${action}.`);
  }
}

export function policyCommandCompletions(prefix: string): AutocompleteItem[] {
  return commonCompletions(prefix, [PolicyCommandAction.SHOW, PolicyCommandAction.CLEAR]);
}

function showPolicies(runtime: AgentRuntime, tokens: string[]) {
  const kind = firstKind(tokens) ?? (tokens.length === 0 ? PolicyCommandKind.ALL : null);
  if (!kind) return err(`Unknown policy kind: ${tokens[0] ?? ""}`);
  return ok(formatPolicyKind(runtime, kind));
}

function clearPolicies(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const clearError = clearOptionsError(options, 1);
  if (clearError) return err(clearError);
  const kind = firstKind(options.operands);
  if (!kind) return err(`Missing or unknown policy kind. Expected one of: ${policyCommandKinds.join(", ")}`);
  if (!options.yes) return err(PolicyCommandText.CLEAR_REQUIRES_YES);
  clearPolicyKind(runtime, kind);
  return ok(formatPolicyKind(runtime, kind));
}

function formatPolicyKind(runtime: AgentRuntime, kind: PolicyCommandKind): string {
  switch (kind) {
    case PolicyCommandKind.ALL:
      return formatPolicySections(
        formatIoPolicies(runtime),
        formatShellPolicies(runtime),
        formatCodePolicies(runtime),
        formatWebPolicies(runtime),
      );
    case PolicyCommandKind.IO:
      return formatIoPolicies(runtime);
    case PolicyCommandKind.SHELL:
      return formatShellPolicies(runtime);
    case PolicyCommandKind.CODE:
      return formatCodePolicies(runtime);
    case PolicyCommandKind.WEB:
      return formatWebPolicies(runtime);
  }
}

