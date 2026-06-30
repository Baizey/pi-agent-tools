import {AutocompleteItem, PiExtensionApi} from "../../../pi/types";
import {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {PolicyLifetime, PolicyStatus, ShellPolicy, ShellPolicyDeleteRequest} from "../../../policy/types";
import {ShellPolicyLogic, shellPolicyCommandArgsFor, shellPolicyFlagsFor} from "../../../policy/shell/ShellPolicyLogic";
import {
  clearOptionsError,
  commonCompletions,
  defaultReason,
  err,
  firstAction,
  maybeSavePolicy,
  ok,
  parseCommonOptions,
  PolicyCommandText,
  tokenizePolicyCommandArgs,
} from "./shared";
import {formatShellEvaluation, formatShellPoliciesList} from "./display";
import {PolicyCommandAction, PolicyCommandKind, PolicyCommandName, policyStatusForAction} from "./types";

const syntheticFlagPolicyCommandReasonPrefix = "Synthetic command allow for flag-specific shell policy.";

export function registerPolicyShellCommand(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerCommand?.(PolicyCommandName.SHELL, {
    description: "Manage explicit shell command policies.",
    getArgumentCompletions: policyShellCompletions,
    handler(args, ctx) {
      const runtime = services.runtimeFor(ctx.cwd ?? process.cwd());
      const result = handlePolicyShellCommand(runtime, args);
      ctx.ui?.notify?.(result.message, result.kind);
    },
  });
}

export function handlePolicyShellCommand(runtime: AgentRuntime, args: string) {
  const tokens = tokenizePolicyCommandArgs(args);
  const action = firstAction(tokens) ?? (tokens.length === 0 ? PolicyCommandAction.SHOW : null);
  if (!action) return err(`Unknown /${PolicyCommandName.SHELL} action: ${tokens[0] ?? ""}`);

  const rest = tokens.slice(action === PolicyCommandAction.SHOW && tokens.length === 0 ? 0 : 1);
  switch (action) {
    case PolicyCommandAction.SHOW:
      return ok(formatShellPolicies(runtime));
    case PolicyCommandAction.EVAL:
      return evalShellPolicy(runtime, rest);
    case PolicyCommandAction.ALLOW:
    case PolicyCommandAction.DENY:
      return addShellPolicy(runtime, action, rest);
    case PolicyCommandAction.REMOVE:
      return removeShellPolicy(runtime, rest);
    case PolicyCommandAction.CLEAR:
      return clearShellPolicies(runtime, rest);
  }
}

export function policyShellCompletions(prefix: string): AutocompleteItem[] {
  return commonCompletions(prefix, [
    PolicyCommandAction.SHOW,
    PolicyCommandAction.EVAL,
    PolicyCommandAction.ALLOW,
    PolicyCommandAction.DENY,
    PolicyCommandAction.REMOVE,
    PolicyCommandAction.CLEAR,
  ]);
}

function addShellPolicy(runtime: AgentRuntime, action: PolicyCommandAction.ALLOW | PolicyCommandAction.DENY, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const command = options.operands.join(" ").trim();
  if (!command) return err(PolicyCommandText.MISSING_COMMAND);

  const commandArgs = shellPolicyCommandArgsFor(command);
  if (commandArgs.length === 0) return err(`Could not infer safe shell policy command scope for: ${command}`);
  const status = policyStatusForAction(action);
  if (!status) return err(`Unsupported /${PolicyCommandName.SHELL} action: ${action}`);
  if (options.allFlags && status === PolicyStatus.DENIED) return err("--all-flags is only valid with allow.");
  const flags = uniqueValues([...shellPolicyFlagsFor(command), ...options.flags]);
  const conflict = sessionWouldShadowForeverShell(runtime, commandArgs, flags, options.lifetime, flags.length > 0 || options.allFlags);
  if (conflict) return err(conflict);
  const reason = options.reason ?? defaultReason(PolicyCommandName.SHELL, action, commandArgs.join(" "));

  runtime.shellPolicy.addPolicies([
    createShellPolicy(runtime, commandArgs, status, options.lifetime, reason, flags, options.allFlags),
  ]);
  maybeSavePolicy(runtime, options.lifetime, PolicyCommandKind.SHELL);
  return ok(formatShellPolicies(runtime));
}

function evalShellPolicy(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const command = options.operands.join(" ").trim();
  if (!command) return err(PolicyCommandText.MISSING_COMMAND);

  const result = runtime.shellPolicy.evaluate(command, false);
  return ok(formatShellEvaluation(command, result, result ? [] : runtime.shellPolicy.pendingPolicyScopeOptions(command)));
}

function removeShellPolicy(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const command = options.operands.join(" ").trim();
  if (!command) return err(PolicyCommandText.MISSING_COMMAND);

  const commandArgs = shellPolicyCommandArgsFor(command);
  if (commandArgs.length === 0) return err(`Could not infer safe shell policy command scope for: ${command}`);
  const flags = uniqueValues([...shellPolicyFlagsFor(command), ...options.flags]);
  const existing = findExactShellPolicy(runtime, commandArgs);
  const removeSyntheticBase = flags.length > 0
    && !options.entire
    && existing?.reason.startsWith(syntheticFlagPolicyCommandReasonPrefix) === true
    && existing.allowAllFlags !== true
    && Object.keys(existing.flags).every((flag) => flags.includes(flag));
  const request: ShellPolicyDeleteRequest = flags.length > 0 && !options.entire && !removeSyntheticBase
    ? {commandArgs, removeEntirePolicy: false, flags}
    : {commandArgs, removeEntirePolicy: true, flags: []};
  runtime.shellPolicy.removePolicies([request]);
  runtime.shellPolicyStore.save(runtime.shellPolicy);
  return ok(formatShellPolicies(runtime));
}

function clearShellPolicies(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const clearError = clearOptionsError(options, 0);
  if (clearError) return err(clearError);
  if (!options.yes) return err(PolicyCommandText.CLEAR_REQUIRES_YES);
  runtime.shellPolicy.removePolicies(runtime.shellPolicy.policiesSnapshot().map((policy) => ({
    commandArgs: policy.commandArgs,
    removeEntirePolicy: true,
    flags: [],
  })));
  runtime.shellPolicyStore.save(runtime.shellPolicy);
  return ok(formatShellPolicies(runtime));
}

function createShellPolicy(
  runtime: AgentRuntime,
  commandArgs: string[],
  status: PolicyStatus,
  lifetime: PolicyLifetime,
  reason: string,
  flags: string[],
  allowAllFlags: boolean,
): ShellPolicy {
  const existing = findExactShellPolicy(runtime, commandArgs);
  if (flags.length > 0 || allowAllFlags) {
    const commandStatus = PolicyStatus.ALLOWED;
    const preservingPersistedAllowedCommand = existing?.status === PolicyStatus.ALLOWED && existing.lifetime === PolicyLifetime.FOREVER && lifetime !== PolicyLifetime.FOREVER;
    const commandLifetime = preservingPersistedAllowedCommand ? existing.lifetime : lifetime;
    const commandReason = preservingPersistedAllowedCommand
      ? existing.reason
      : existing === undefined || existing.status !== PolicyStatus.ALLOWED
        ? `${syntheticFlagPolicyCommandReasonPrefix} ${reason}`
        : reason;
    return ShellPolicyLogic.createPolicy(
      commandArgs,
      commandStatus,
      commandLifetime,
      commandReason,
      flags.map((flag) => ShellPolicyLogic.createFlagStatus(flag, status, lifetime, reason)),
      allowAllFlags || existing?.allowAllFlags === true,
    );
  }
  return ShellPolicyLogic.createPolicy(commandArgs, status, lifetime, reason);
}

function sessionWouldShadowForeverShell(runtime: AgentRuntime, commandArgs: string[], flags: string[], lifetime: PolicyLifetime, flagOnly: boolean): string | null {
  if (lifetime === PolicyLifetime.FOREVER) return null;
  const existing = findExactShellPolicy(runtime, commandArgs);
  if (!existing) return null;
  if ((!flagOnly || existing.status !== PolicyStatus.ALLOWED) && existing.lifetime === PolicyLifetime.FOREVER) {
    return "Refusing to shadow forever shell command policy with a session policy. Remove it first or use --lifetime forever.";
  }
  const flagConflicts = flags.filter((flag) => existing.flags[flag]?.lifetime === PolicyLifetime.FOREVER);
  return flagConflicts.length > 0
    ? `Refusing to shadow forever shell flag policy with a session policy for: ${flagConflicts.join(", ")}. Remove it first or use --lifetime forever.`
    : null;
}

function findExactShellPolicy(runtime: AgentRuntime, commandArgs: string[]): ShellPolicy | undefined {
  return runtime.shellPolicy.policiesSnapshot().find((policy) => arraysEqual(policy.commandArgs, commandArgs));
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function formatShellPolicies(runtime: AgentRuntime): string {
  return formatShellPoliciesList(runtime.shellPolicy.policiesSnapshot());
}
