import {AutocompleteItem, PiExtensionApi} from "../../../pi/types";
import {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {parseWebPolicyUrl} from "../../../policy/web/WebPolicyLogic";
import {PolicyLifetime, WebAccessType} from "../../../policy/types";
import {
  clearOptionsError,
  commonCompletions,
  defaultReason,
  err,
  firstAction,
  maybeSavePolicy,
  ok,
  parseCommonOptions,
  parseWebAccessType,
  parseWebAccessTypes,
  PolicyCommandText,
  tokenizePolicyCommandArgs,
} from "./shared";
import {formatWebEvaluations, formatWebPoliciesList} from "./display";
import {PolicyCommandAction, PolicyCommandKind, PolicyCommandName, policyStatusForAction} from "./types";

export function registerPolicyWebCommand(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerCommand?.(PolicyCommandName.WEB, {
    description: "Manage explicit web policies.",
    getArgumentCompletions: policyWebCompletions,
    handler(args, ctx) {
      const runtime = services.runtimeFor(ctx.cwd ?? process.cwd());
      const result = handlePolicyWebCommand(runtime, args);
      ctx.ui?.notify?.(result.message, result.kind);
    },
  });
}

export function handlePolicyWebCommand(runtime: AgentRuntime, args: string) {
  const tokens = tokenizePolicyCommandArgs(args);
  const action = firstAction(tokens) ?? (tokens.length === 0 ? PolicyCommandAction.SHOW : null);
  if (!action) return err(`Unknown /${PolicyCommandName.WEB} action: ${tokens[0] ?? ""}`);

  const rest = tokens.slice(action === PolicyCommandAction.SHOW && tokens.length === 0 ? 0 : 1);
  switch (action) {
    case PolicyCommandAction.SHOW:
      return ok(formatWebPolicies(runtime));
    case PolicyCommandAction.EVAL:
      return evalWebPolicy(runtime, rest);
    case PolicyCommandAction.ALLOW:
    case PolicyCommandAction.DENY:
      return addWebPolicy(runtime, action, rest);
    case PolicyCommandAction.REMOVE:
      return removeWebPolicy(runtime, rest);
    case PolicyCommandAction.CLEAR:
      return clearWebPolicies(runtime, rest);
  }
}

export function policyWebCompletions(prefix: string): AutocompleteItem[] {
  return commonCompletions(prefix, [
    PolicyCommandAction.SHOW,
    PolicyCommandAction.EVAL,
    PolicyCommandAction.ALLOW,
    PolicyCommandAction.DENY,
    PolicyCommandAction.REMOVE,
    PolicyCommandAction.CLEAR,
  ]);
}

function addWebPolicy(runtime: AgentRuntime, action: PolicyCommandAction.ALLOW | PolicyCommandAction.DENY, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [url, ...accessTokens] = options.operands;
  if (!url) return err(PolicyCommandText.MISSING_URL);
  const target = parseWebPolicyUrl(url);
  if (!target) return err(`Invalid web policy URL: ${url}`);

  const parsed = parseWebAccessTypes(accessTokens);
  if (parsed.unknown.length > 0) return err(`Unknown web access type: ${parsed.unknown.join(", ")}`);
  const status = policyStatusForAction(action);
  if (!status) return err(`Unsupported /${PolicyCommandName.WEB} action: ${action}`);
  const conflict = sessionWouldShadowForeverWeb(runtime, target.host, target.path, parsed.accessTypes, options.lifetime);
  if (conflict) return err(conflict);
  const reason = options.reason ?? defaultReason(PolicyCommandName.WEB, action, target.url);
  const policies = parsed.accessTypes.map((accessType) => runtime.webPolicy.createPolicyForScope({
    label: `${accessType} ${target.host}${target.path}`,
    host: target.host,
    path: target.path,
    accessType,
  }, options.lifetime, status, reason));

  runtime.webPolicy.addPolicies(policies);
  maybeSavePolicy(runtime, options.lifetime, PolicyCommandKind.WEB);
  return ok(formatWebPolicies(runtime));
}

function evalWebPolicy(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [url, accessToken] = options.operands;
  if (!url) return err(PolicyCommandText.MISSING_URL);

  const accessTypes = accessToken ? [parseWebAccessType(accessToken)] : Object.values(WebAccessType);
  if (accessTypes.some((it) => !it)) return err(`Unknown web access type: ${accessToken}`);
  const evaluations = (accessTypes as WebAccessType[]).map((accessType) => ({
    accessType,
    result: runtime.webPolicy.evaluate(url, accessType, false),
  }));
  return ok(formatWebEvaluations(url, evaluations));
}

function removeWebPolicy(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [url, ...accessTokens] = options.operands;
  if (!url) return err(PolicyCommandText.MISSING_URL);
  const target = parseWebPolicyUrl(url);
  if (!target) return err(`Invalid web policy URL: ${url}`);

  const parsed = parseWebAccessTypes(accessTokens);
  if (parsed.unknown.length > 0) return err(`Unknown web access type: ${parsed.unknown.join(", ")}`);
  runtime.webPolicy.removePolicies(parsed.accessTypes.map((accessType) => ({
    host: target.host,
    path: target.path,
    accessType,
  })));
  runtime.webPolicyStore.save(runtime.webPolicy);
  return ok(formatWebPolicies(runtime));
}

function clearWebPolicies(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const clearError = clearOptionsError(options, 0);
  if (clearError) return err(clearError);
  if (!options.yes) return err(PolicyCommandText.CLEAR_REQUIRES_YES);
  runtime.webPolicy.removePolicies(runtime.webPolicy.policiesSnapshot().map((policy) => ({
    host: policy.host,
    path: policy.path,
    accessType: policy.accessType,
  })));
  runtime.webPolicyStore.save(runtime.webPolicy);
  return ok(formatWebPolicies(runtime));
}

function sessionWouldShadowForeverWeb(runtime: AgentRuntime, host: string, path: string, accessTypes: WebAccessType[], lifetime: PolicyLifetime): string | null {
  if (lifetime === PolicyLifetime.FOREVER) return null;
  const conflicts = accessTypes.filter((accessType) => runtime.webPolicy.policiesSnapshot().some((policy) =>
    policy.host === host && policy.path === path && policy.accessType === accessType && policy.lifetime === PolicyLifetime.FOREVER,
  ));
  return conflicts.length > 0
    ? `Refusing to shadow forever web policy with a session policy for: ${conflicts.join(", ")}. Remove it first or use --lifetime forever.`
    : null;
}

export function formatWebPolicies(runtime: AgentRuntime): string {
  return formatWebPoliciesList(runtime.webPolicy.policiesSnapshot());
}
