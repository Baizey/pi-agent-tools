import {ExtensionContext} from "../../../pi/types";
import {AgentRuntime} from "../../../pi/runtime";
import {PolicyLifetime, PolicyStatus, ShellPolicyDeleteRequest, ShellPolicyResult} from "../../../policy/types";
import {askPolicyApproval, isPolicyApprovalFailure} from "../../shared/policy-approval";
import {describeShellPolicyScopes, getBashSummary, summarizeCommandForApproval} from "./approval-descriptions";

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

  const approval = await askPolicyApproval(ctx, {
    policyKind: "shell",
    target: command,
    scopes: scopeOptions.map((scope) => ({
      label: scope.label,
      value: scope,
    })),
    context: [
      `Command: ${command}`,
      `Current working directory: ${ctx.cwd}`,
    ],
    contextOptionLabel: "ⓘ Explain what this command and its flags do before deciding",
    loadContext: async () => {
      await summarizeCommandForApproval(command, ctx);
      const scopeDescriptions = await describeShellPolicyScopes(command, scopeOptions, ctx);
      const summary = getBashSummary(command);
      return {
        intro: summary ? `Command summary: ${summary}` : undefined,
        scopeDescriptions,
      };
    },
    scopePrompt: `Select shell policy scope for unmatched command in: ${command}`,
    statusPrompt: (scope) => scope.description
      ? `Shell policy for ${scope.label}: ${scope.description}`
      : `Shell policy for ${scope.label}`,
    lifetimePrompt: "Shell policy lifetime",
    defaultReason: (status) => `User selected ${status} for shell command.`,
  });
  if (isPolicyApprovalFailure(approval)) return failed(approval.deniedReason);

  const scope = approval.scope.value;
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

