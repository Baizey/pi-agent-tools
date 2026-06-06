import {ExtensionContext} from "../../../pi/types";
import {AgentRuntime} from "../../../pi/runtime";
import {PolicyLifetime, PolicyStatus, ShellPolicyDeleteRequest, ShellPolicyResult, ShellPolicyScopeOption} from "../../../policy/types";
import {UiDecision, UiDecisionFlowManager} from "../../ui-flow";
import {UIAiHelpWrap} from "../../ui-flow/DecisionAiHelper";

export async function ensureShellAllowed(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  command: string,
  denyByDefault: boolean,
): Promise<string | null> {
  const oneShotPolicies: ShellPolicyDeleteRequest[] = [];

  try {
    for (let attempts = 0; attempts < 10; attempts++) {
      const result = runtime.shellPolicy.evaluate(command, denyByDefault);
      if (result === null) {
        const promptResult = await askForShellPolicy(ctx, runtime, command, oneShotPolicies);
        if (promptResult === null) continue;
        return runtime.shellPolicy.toDenyReasonOrNull(promptResult) ?? "Execution denied.";
      }

      if (result.allowed) return null;
      return runtime.shellPolicy.toDenyReasonOrNull(result) ?? "Execution denied.";
    }

    return "Execution denied: shell policy could not be resolved.";
  } finally {
    runtime.shellPolicy.removePolicies(oneShotPolicies);
  }
}

async function askForShellPolicy(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  command: string,
  oneShotPolicies: ShellPolicyDeleteRequest[],
): Promise<ShellPolicyResult | null> {
  const failed = (reason: string): ShellPolicyResult => ({
    command,
    segmentResults: [
      {
        rawSegment: command,
        commandPrefix: [],
        flags: [],
        lifetime: PolicyLifetime.ONCE,
        status: PolicyStatus.DENIED,
        reason,
        allowed: false,
        denied: true,
      },
    ],
    allowed: false,
    denied: true,
  });

  if (!ctx.ui || ctx.hasUI === false) {
    return failed(`No shell policy matched '${command}' and interactive approval is unavailable.`);
  }

  const scopeOptions = runtime.shellPolicy.pendingPolicyScopeOptions(command);
  if (scopeOptions.length === 0) {
    return failed(`No safe shell policy scope could be inferred for '${command}'.`);
  }

  const approval = await askShellPolicyWithFlow(ctx, command, scopeOptions);

  const scope = approval.scope;
  const policy = runtime.shellPolicy.createPolicyForScope(scope, approval.status, approval.lifetime, approval.reason);

  runtime.shellPolicy.addPolicies([policy]);
  if (approval.lifetime === PolicyLifetime.ONCE) {
    oneShotPolicies.push({commandArgs: scope.commandArgs, removeEntirePolicy: true, flags: []});
  } else if (approval.lifetime === PolicyLifetime.FOREVER) {
    runtime.shellPolicyStore.save(runtime.shellPolicy);
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
): Promise<ShellPolicyApproval> {
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
    title: () => [
      `Select shell policy scope for unmatched command in: ${command}`,
      `Approval target: ${command}`,
      `Current working directory: ${ctx.cwd}`,
    ].join("\n"),
    showAiHelpOption: true,
    options: scopes.map((scope) => ({
      title: () => scope.label,
      value: scope,
      next: () => "status",
    })),
  } satisfies UiDecision<ShellPolicyApproval>;

  const statusDecision = {
    type: "select",
    key: "status",
    title: (state) => [
      state.scope ? `Shell policy for ${state.scope.label}` : "Shell policy",
      `Approval target: ${command}`,
      `Current working directory: ${ctx.cwd}`,
    ].join("\n"),
    showAiHelpOption: true,
    options: [
      {title: () => "Allow", value: PolicyStatus.ALLOWED, next: () => "lifetime"},
      {title: () => "Deny", value: PolicyStatus.DENIED, next: () => "lifetime"},
    ],
  } satisfies UiDecision<ShellPolicyApproval>;

  const lifetimeDecision = {
    type: "select",
    key: "lifetime",
    title: () => [
      "Shell policy lifetime",
      `Approval target: ${command}`,
    ].join("\n"),
    showAiHelpOption: false,
    options: [
      {title: () => PolicyLifetime.ONCE, value: PolicyLifetime.ONCE, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
      {title: () => PolicyLifetime.SESSION, value: PolicyLifetime.SESSION, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
      {title: () => PolicyLifetime.FOREVER, value: PolicyLifetime.FOREVER, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
    ],
  } satisfies UiDecision<ShellPolicyApproval>;

  const reasonDecision = {
    type: "input",
    key: "reason",
    title: () => [
      "Reason for denying this shell policy (optional)",
      `Approval target: ${command}`,
    ].join("\n"),
    placeholder: (state) => defaultReason(state.status ?? PolicyStatus.DENIED),
    next: () => null,
  } satisfies UiDecision<ShellPolicyApproval>;

  const approval = await new UiDecisionFlowManager(ctx).runFlow(
    scopeDecision,
    {scope: scopeDecision, status: statusDecision, lifetime: lifetimeDecision, reason: reasonDecision},
    onCancelReturn,
    aiHelp,
  );

  return {
    ...approval,
    reason: approval.reason || defaultReason(approval.status),
  };
}

function shellFlowCancelReason(state: Partial<ShellPolicyApproval>): string {
  if (!state.scope) return "No shell policy scope selected.";
  if (!state.status) return "No shell policy decision selected.";
  if (!state.lifetime) return "No shell policy lifetime selected.";
  return "No shell policy reason selected.";
}

