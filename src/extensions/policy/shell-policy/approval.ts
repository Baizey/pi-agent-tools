import {ExtensionContext} from "../../../pi/types";
import {AgentRuntime} from "../../../pi/runtime";
import {ShellPolicyLogic} from "../../../policy/shell/ShellPolicyLogic";
import {PolicyLifetime, PolicyResolutionSource, PolicyStatus, ShellPolicyResult, ShellPolicyScopeOption} from "../../../policy/types";
import {UiDecision, UiDecisionFlowManager, UiFlowShortcut} from "../../shared/ui-flow";
import {UIAiHelpWrap} from "../../shared/ui-flow/DecisionAiHelper";

export async function ensureShellAllowed(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  command: string,
  denyByDefault: boolean,
): Promise<string | null> {
  const requestPolicy = new ShellPolicyLogic({policies: runtime.shellPolicy.policiesSnapshot()});
  let usedNewUserDecision = false;

  for (let attempts = 0; attempts < 20; attempts++) {
    const result = requestPolicy.evaluate(command, denyByDefault);
    if (result === null) {
      const promptResult = await askForShellPolicy(ctx, runtime, requestPolicy, command);
      usedNewUserDecision = true;
      if (promptResult === null) continue;
      return requestPolicy.toDenyReasonOrNull(promptResult) ?? "Execution denied.";
    }

    const resolvedResult = usedNewUserDecision ? withShellResolutionSource(result, PolicyResolutionSource.NEW_USER_DECISION) : result;
    if (resolvedResult.allowed) return null;
    return requestPolicy.toDenyReasonOrNull(resolvedResult) ?? "Execution denied.";
  }

  return "Execution denied: shell policy could not be resolved.";
}

async function askForShellPolicy(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  requestPolicy: ShellPolicyLogic,
  command: string,
): Promise<ShellPolicyResult | null> {
  const failed = (reason: string, source = PolicyResolutionSource.SYSTEM): ShellPolicyResult => ({
    command,
    segmentResults: [
      {
        rawSegment: command,
        commandPrefix: [],
        flags: [],
        lifetime: PolicyLifetime.ONCE,
        status: PolicyStatus.DENIED,
        reason,
        resolutionSource: source,
        allowed: false,
        denied: true,
      },
    ],
    resolutionSource: source,
    allowed: false,
    denied: true,
  });

  if (!ctx.ui || ctx.hasUI === false) {
    return failed(`No shell policy matched '${command}' and interactive approval is unavailable.`);
  }

  const scopeOptions = requestPolicy.pendingPolicyScopeOptions(command);
  if (scopeOptions.length === 0) {
    return failed(`No safe shell policy scope could be inferred for '${command}'.`);
  }

  const approval = await askShellPolicyWithFlow(ctx, command, scopeOptions);
  if (approval === UiFlowShortcut.ALLOW_ALL_ONCE) {
    resolveAllRemainingShellScopesOnce(requestPolicy, command, `User selected ${PolicyStatus.ALLOWED} for shell command.`);
    return null;
  }
  if (approval === UiFlowShortcut.DENY_ALL_ONCE) {
    const defaultReason = `User selected ${PolicyStatus.DENIED} for shell command.`;
    const reason = await ctx.ui?.input?.("Reason for denying shell request once (optional)", defaultReason);
    return failed(reason || defaultReason, PolicyResolutionSource.NEW_USER_DECISION);
  }

  const scope = approval.scope;
  const policy = requestPolicy.createPolicyForScope(scope, approval.status, approval.lifetime, approval.reason);

  requestPolicy.addPolicies([policy]);
  if (approval.lifetime !== PolicyLifetime.ONCE) {
    runtime.shellPolicy.addPolicies([policy]);
    if (approval.lifetime === PolicyLifetime.FOREVER) {
      runtime.shellPolicyStore.save(runtime.shellPolicy);
    }
  }

  // The new decision may only resolve one segment or one exact command+flag set.
  // Return null so ensureShellAllowed re-evaluates and prompts again if more
  // unknown shell policy remains.
  return null;
}

type ShellPolicyApproval = {
  scope: ShellPolicyScopeOption;
  status: PolicyStatus;
  lifetime: PolicyLifetime;
  reason: string;
};

async function askShellPolicyWithFlow(
  ctx: ExtensionContext,
  command: string,
  scopes: ShellPolicyScopeOption[],
): Promise<ShellPolicyApproval | UiFlowShortcut> {
  const defaultReason = (status: PolicyStatus) => `User selected ${status} for shell command.`;
  const aiHelp = new UIAiHelpWrap({
    task: "You explain bash commands and shell policy scopes for approval UI. Be concise and neutral.",
    fullItem: command,
    subItems: scopes.map((scope) => scope.label),
    optionLabel: "ⓘ Explain what this command and its flags do before deciding",
  });
  const onCancelReturn = (state: Partial<ShellPolicyApproval>): ShellPolicyApproval => ({
    scope: state.scope ?? scopes[0],
    status: PolicyStatus.DENIED,
    lifetime: PolicyLifetime.ONCE,
    reason: `Execution denied: ${shellFlowCancelReason(state)}`,
  });

  const scopeDecision = {
    type: "select",
    key: "scope",
    title: [
      "Shell policy approval",
      `Working directory: ${ctx.cwd}`,
      "Choose the narrowest scope you want this decision to apply to.",
    ].join("\n"),
    showAiHelpOption: true,
    options: scopes.map((scope) => ({
      title: scope.label,
      value: scope,
      next: "status",
    })),
  } satisfies UiDecision<ShellPolicyApproval>;

  const statusDecision = {
    type: "select",
    key: "status",
    title: (state) => [
      "Shell policy decision",
      state.scope ? `Scope: ${state.scope.label}` : "Scope: (none selected)",
      `Working directory: ${ctx.cwd}`,
    ].join("\n"),
    showAiHelpOption: true,
    options: [
      {title: "Allow", value: PolicyStatus.ALLOWED, next: "lifetime"},
      {title: "Deny", value: PolicyStatus.DENIED, next: "lifetime"},
    ],
  } satisfies UiDecision<ShellPolicyApproval>;

  const lifetimeDecision = {
    type: "select",
    key: "lifetime",
    title: "Shell policy lifetime",
    showAiHelpOption: false,
    options: [
      {title: PolicyLifetime.ONCE, value: PolicyLifetime.ONCE, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
      {title: PolicyLifetime.SESSION, value: PolicyLifetime.SESSION, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
      {title: PolicyLifetime.FOREVER, value: PolicyLifetime.FOREVER, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
    ],
  } satisfies UiDecision<ShellPolicyApproval>;

  const reasonDecision = {
    type: "input",
    key: "reason",
    title: "Reason for denying this shell policy (optional)",
    placeholder: (state) => defaultReason(state.status ?? PolicyStatus.DENIED),
    next: null,
  } satisfies UiDecision<ShellPolicyApproval>;

  const approval = await new UiDecisionFlowManager(ctx).runFlow(
    scopeDecision,
    {scope: scopeDecision, status: statusDecision, lifetime: lifetimeDecision, reason: reasonDecision},
    onCancelReturn,
    aiHelp,
    {enabled: true},
  );

  if (approval === UiFlowShortcut.ALLOW_ALL_ONCE || approval === UiFlowShortcut.DENY_ALL_ONCE) return approval;

  return {
    ...approval,
    reason: approval.reason || defaultReason(approval.status),
  };
}

function resolveAllRemainingShellScopesOnce(
  policy: ShellPolicyLogic,
  command: string,
  reason: string,
): void {
  for (let attempts = 0; attempts < 20; attempts++) {
    const scope = policy.pendingPolicyScopeOptions(command)[0];
    if (!scope) return;
    policy.addPolicies([policy.createPolicyForScope(scope, PolicyStatus.ALLOWED, PolicyLifetime.ONCE, reason)]);
  }
}

function withShellResolutionSource(result: ShellPolicyResult, source: PolicyResolutionSource): ShellPolicyResult {
  return {
    ...result,
    resolutionSource: source,
    segmentResults: result.segmentResults.map((segment) => ({...segment, resolutionSource: source})),
  };
}

function shellFlowCancelReason(state: Partial<ShellPolicyApproval>): string {
  if (!state.scope) return "No shell policy scope selected.";
  if (!state.status) return "No shell policy decision selected.";
  if (!state.lifetime) return "No shell policy lifetime selected.";
  return "No shell policy reason selected.";
}

