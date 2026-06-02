import {ExtensionContext} from "../../pi/types";
import {AgentRuntime} from "../../pi/runtime";
import {PolicyLifetime, PolicyStatus, ShellPolicyDeleteRequest, ShellPolicyResult} from "../../policy/types";
import {describeShellPolicyScopes, summarizeCommandForApproval} from "./approval-descriptions";

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

  await summarizeCommandForApproval(command, ctx);
  const scopeDescriptions = await describeShellPolicyScopes(command, scopeOptions, ctx);
  const scopeLabels = new Map(scopeOptions.map((option) => {
    const description = scopeDescriptions.get(option.label);
    return [description ? `${option.label} — ${description}` : option.label, option] as const;
  }));

  const scopeChoice = await ctx.ui.select(
    `Select shell policy scope for unmatched command in: ${command}`,
    [...scopeLabels.keys()],
  );
  if (!scopeChoice) return failed("No shell policy scope selected.");

  const scope = scopeLabels.get(scopeChoice) ?? scopeOptions[0];
  const scopeDescription = scopeDescriptions.get(scope.label);
  const statusTitle = scopeDescription
    ? `Shell policy for ${scope.label}: ${scopeDescription}`
    : `Shell policy for ${scope.label}`;

  const statusChoice = await ctx.ui.select(statusTitle, ["Allow", "Deny"]);
  if (!statusChoice) return failed("No shell policy decision selected.");

  const lifetimeChoice = await ctx.ui.select("Shell policy lifetime", [
    PolicyLifetime.ONCE,
    PolicyLifetime.SESSION,
    PolicyLifetime.FOREVER,
  ]);
  if (!lifetimeChoice) return failed("No shell policy lifetime selected.");

  const status = statusChoice === "Allow" ? PolicyStatus.ALLOWED : PolicyStatus.DENIED;
  const lifetime = lifetimeChoice as PolicyLifetime;
  const defaultReason = `User selected ${status} for shell command.`;
  const reason = status === PolicyStatus.DENIED
    ? await askForDenyReason(ctx, defaultReason)
    : defaultReason;
  const policy = runtime.shellPolicy.createPolicyForScope(scope, status, lifetime, reason);

  runtime.shellPolicy.addPolicies([policy]);
  if (lifetime === PolicyLifetime.ONCE) {
    oneShotPolicies.push({commandArgs: scope.commandArgs, removeEntirePolicy: true, flags: []});
  } else if (lifetime === PolicyLifetime.FOREVER) {
    runtime.shellPolicyStore.save(runtime.shellPolicy);
  }

  // The new decision may only resolve one segment or one exact command+flag set.
  // Return null so ensureShellAllowed re-evaluates and prompts again if more
  // unknown shell policy remains.
  return null;
}

async function askForDenyReason(ctx: ExtensionContext, defaultReason: string): Promise<string> {
  if (!ctx.ui?.input) return defaultReason;
  const reason = await ctx.ui.input("Reason for denying this shell policy (optional)", defaultReason);
  const trimmed = reason?.trim();
  return trimmed ? trimmed : defaultReason;
}
