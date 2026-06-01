import {ExtensionContext, PiExtensionApi} from "../../pi/types";
import {AgentRuntime, AgentServices} from "../../pi/runtime";
import {PolicyLifetime, PolicyStatus, ShellPolicyDeleteRequest, ShellPolicyResult} from "../../policy/types";
import {agentEnv, isAgentEnvEnabled} from "../../shared/env";
import {toolNames} from "../../shared/toolNames";
import {stringValue} from "../../shared/values";

export function registerShellPolicy(pi: PiExtensionApi, services: AgentServices): void {
  registerBashPromptGuidance(pi);

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== toolNames.bash) return;

    const runtime = services.runtimeFor(ctx.cwd);
    const command = stringValue(event.input.command) ?? "";
    const reason = await ensureShellAllowed(ctx, runtime, command, isAgentEnvEnabled(agentEnv.shellDenyByDefault));
    if (reason) return {block: true, reason};
  });
}

function registerBashPromptGuidance(pi: PiExtensionApi): void {
  pi.on("before_agent_start", (event) => {
    if (!isBashSelected(event.systemPromptOptions?.selectedTools)) return;
    if (event.systemPrompt.includes(bashPolicyGuidanceHeader)) return;
    return {systemPrompt: `${event.systemPrompt}\n\n${bashPolicyGuidance}`};
  });
}

function isBashSelected(selectedTools: Array<string | {name?: string}> | undefined): boolean {
  if (!selectedTools) return true;
  return selectedTools.some((tool) => typeof tool === "string" ? tool === toolNames.bash : tool.name === toolNames.bash);
}

const bashPolicyGuidanceHeader = "### Bash policy-friendly command formatting";
const bashPolicyGuidance = `${bashPolicyGuidanceHeader}
When using bash, format commands so shell policy can distinguish command core, flags, and argument values:
- Keep command core words at the start only, e.g. executable plus common subcommand like git status or npm test.
- Quote string/pattern/message values.
- Use file/path-like values plainly; they are arguments, not command core.
- Put flags before their values, and use -- before positional values that may start with -.
- Avoid shell expansion, redirection, command substitution, eval/source/exec, and nested shells unless explicitly requested.
- Prefer structured file tools over shell commands for filesystem changes.`;

async function ensureShellAllowed(
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

  const scopeChoice = await ctx.ui.select(
    `Select shell policy scope for unmatched command in: ${command}`,
    scopeOptions.map((option) => option.label),
  );
  if (!scopeChoice) return failed("No shell policy scope selected.");

  const scope = scopeOptions.find((option) => option.label === scopeChoice) ?? scopeOptions[0];

  const statusChoice = await ctx.ui.select(`Shell policy for ${scope.label}`, ["Allow", "Deny"]);
  if (!statusChoice) return failed("No shell policy decision selected.");

  const lifetimeChoice = await ctx.ui.select("Shell policy lifetime", [
    PolicyLifetime.ONCE,
    PolicyLifetime.SESSION,
    PolicyLifetime.FOREVER,
  ]);
  if (!lifetimeChoice) return failed("No shell policy lifetime selected.");

  const status = statusChoice === "Allow" ? PolicyStatus.ALLOWED : PolicyStatus.DENIED;
  const lifetime = lifetimeChoice as PolicyLifetime;
  const reason = `User selected ${status} for shell command.`;
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
