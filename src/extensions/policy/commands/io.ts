import {AutocompleteItem, PiExtensionApi} from "../../../pi/types";
import {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {FsAccessType, PathPolicy, PolicyLifetime, PolicyStatus} from "../../../policy/types";
import {PathPolicyLogic} from "../../../policy/path/PathPolicyLogic";
import {
  clearOptionsError,
  commonCompletions,
  defaultReason,
  err,
  firstAction,
  maybeSavePolicy,
  ok,
  parseCommonOptions,
  parseFsAccessType,
  parseFsAccessTypes,
  PolicyCommandText,
  tokenizePolicyCommandArgs,
} from "./shared";
import {formatIoEvaluations, formatIoPoliciesList} from "./display";
import {PolicyCommandAction, PolicyCommandKind, PolicyCommandName, policyStatusForAction} from "./types";

export function registerPolicyIoCommand(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerCommand?.(PolicyCommandName.IO, {
    description: "Manage explicit filesystem/path policies.",
    getArgumentCompletions: policyIoCompletions,
    handler(args, ctx) {
      const runtime = services.runtimeFor(ctx.cwd ?? process.cwd());
      const result = handlePolicyIoCommand(runtime, args);
      ctx.ui?.notify?.(result.message, result.kind);
    },
  });
}

export function handlePolicyIoCommand(runtime: AgentRuntime, args: string) {
  const tokens = tokenizePolicyCommandArgs(args);
  const action = firstAction(tokens) ?? (tokens.length === 0 ? PolicyCommandAction.SHOW : null);
  if (!action) return err(`Unknown /${PolicyCommandName.IO} action: ${tokens[0] ?? ""}`);

  const rest = tokens.slice(action === PolicyCommandAction.SHOW && tokens.length === 0 ? 0 : 1);
  switch (action) {
    case PolicyCommandAction.SHOW:
      return ok(formatIoPolicies(runtime));
    case PolicyCommandAction.EVAL:
      return evalIoPolicy(runtime, rest);
    case PolicyCommandAction.ALLOW:
    case PolicyCommandAction.DENY:
      return addIoPolicy(runtime, action, rest);
    case PolicyCommandAction.REMOVE:
      return removeIoPolicy(runtime, rest);
    case PolicyCommandAction.CLEAR:
      return clearIoPolicies(runtime, rest);
  }
}

export function policyIoCompletions(prefix: string): AutocompleteItem[] {
  return commonCompletions(prefix, [
    PolicyCommandAction.SHOW,
    PolicyCommandAction.EVAL,
    PolicyCommandAction.ALLOW,
    PolicyCommandAction.DENY,
    PolicyCommandAction.REMOVE,
    PolicyCommandAction.CLEAR,
  ]);
}

function addIoPolicy(runtime: AgentRuntime, action: PolicyCommandAction.ALLOW | PolicyCommandAction.DENY, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [policyPath, ...accessTokens] = options.operands;
  if (!policyPath) return err(PolicyCommandText.MISSING_PATH);

  const parsed = parseFsAccessTypes(accessTokens);
  if (parsed.unknown.length > 0) return err(`Unknown filesystem access type: ${parsed.unknown.join(", ")}`);

  const status = policyStatusForAction(action);
  if (!status) return err(`Unsupported /${PolicyCommandName.IO} action: ${action}`);
  const conflict = sessionWouldShadowForeverPath(runtime, policyPath, parsed.accessTypes, options.lifetime);
  if (conflict) return err(conflict);
  const reason = options.reason ?? defaultReason(PolicyCommandName.IO, action, policyPath);
  const policy = createPathPolicy(policyPath, parsed.accessTypes, status, options.lifetime, reason);
  runtime.pathPolicy.addPolicies([policy]);
  maybeSavePolicy(runtime, options.lifetime, PolicyCommandKind.IO);
  return ok(formatIoPolicies(runtime));
}

function evalIoPolicy(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [policyPath, accessToken] = options.operands;
  if (!policyPath) return err(PolicyCommandText.MISSING_PATH);

  const accessTypes = accessToken ? [parseFsAccessType(accessToken)] : Object.values(FsAccessType);
  if (accessTypes.some((it) => !it)) return err(`Unknown filesystem access type: ${accessToken}`);
  const evaluations = (accessTypes as FsAccessType[]).map((accessType) => ({
    accessType,
    result: runtime.pathPolicy.evaluate(policyPath, accessType, false),
  }));
  return ok(formatIoEvaluations(policyPath, evaluations));
}

function removeIoPolicy(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const [policyPath, ...accessTokens] = options.operands;
  if (!policyPath) return err(PolicyCommandText.MISSING_PATH);

  const parsed = parseFsAccessTypes(accessTokens);
  if (parsed.unknown.length > 0) return err(`Unknown filesystem access type: ${parsed.unknown.join(", ")}`);
  runtime.pathPolicy.removePolicies([{path: policyPath, accessTypes: parsed.accessTypes}]);
  runtime.pathPolicyStore.save(runtime.pathPolicy);
  return ok(formatIoPolicies(runtime));
}

function clearIoPolicies(runtime: AgentRuntime, tokens: string[]) {
  const options = parseCommonOptions(tokens);
  if (options.error) return err(options.error);
  const clearError = clearOptionsError(options, 0);
  if (clearError) return err(clearError);
  if (!options.yes) return err(PolicyCommandText.CLEAR_REQUIRES_YES);
  runtime.pathPolicy.removePolicies(runtime.pathPolicy.policiesSnapshot().map((policy) => ({
    path: policy.path,
    accessTypes: Object.values(FsAccessType),
  })));
  runtime.pathPolicyStore.save(runtime.pathPolicy);
  return ok(formatIoPolicies(runtime));
}

function sessionWouldShadowForeverPath(runtime: AgentRuntime, policyPath: string, accessTypes: FsAccessType[], lifetime: PolicyLifetime): string | null {
  if (lifetime === PolicyLifetime.FOREVER) return null;
  const exactPath = runtime.pathPolicy.policyPathFor(policyPath);
  const existing = runtime.pathPolicy.policiesSnapshot().find((policy) => policy.path === exactPath);
  const conflicts = accessTypes.filter((accessType) => existing?.info[accessType]?.lifetime === PolicyLifetime.FOREVER);
  return conflicts.length > 0
    ? `Refusing to shadow forever IO policy with a session policy for: ${conflicts.join(", ")}. Remove it first or use --lifetime forever.`
    : null;
}

function createPathPolicy(policyPath: string, accessTypes: FsAccessType[], status: PolicyStatus, lifetime: PolicyLifetime, reason: string): PathPolicy {
  return {
    path: policyPath,
    info: Object.fromEntries(accessTypes.map((accessType) => [
      accessType,
      PathPolicyLogic.createStatus(accessType, lifetime, status, reason),
    ])) as PathPolicy["info"],
  };
}

export function formatIoPolicies(runtime: AgentRuntime): string {
  return formatIoPoliciesList(runtime.pathPolicy.policiesSnapshot());
}
