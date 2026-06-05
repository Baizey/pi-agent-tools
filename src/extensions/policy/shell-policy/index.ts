import {ExtensionContext, PiExtensionApi} from "../../../pi/types";
import {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {agentEnv, isAgentEnvEnabled} from "../../../shared/env";
import {toolNames} from "../../../shared/toolNames";
import {stringValue} from "../../../shared/values";
import {ensurePathAllowed} from "../path-policy";
import {ensureShellAllowed} from "./approval";
import {bashPathAccesses} from "./bash-paths";
import {registerBashSummaryRenderer} from "./bash-renderer";
import {registerBashPromptGuidance} from "./guidance";

export function registerShellPolicy(pi: PiExtensionApi, services: AgentServices): void {
  registerBashPromptGuidance(pi);
  registerBashSummaryRenderer(pi);

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== toolNames.bash) return;

    const runtime = services.runtimeFor(ctx.cwd);
    const command = stringValue(event.input.command) ?? "";

    const shellDenyReason = await ensureShellAllowed(
      ctx,
      runtime,
      command,
      isAgentEnvEnabled(agentEnv.shellDenyByDefault),
    );
    if (shellDenyReason) return {block: true, reason: shellDenyReason};

    const pathDenyReason = await ensureBashPathsAllowed(
      ctx,
      runtime,
      command,
      isAgentEnvEnabled(agentEnv.pathDenyByDefault),
    );
    if (pathDenyReason) return {block: true, reason: pathDenyReason};
  });
}

async function ensureBashPathsAllowed(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  command: string,
  denyByDefault: boolean,
): Promise<string | null> {
  for (const access of bashPathAccesses(command)) {
    const reason = await ensurePathAllowed(ctx, runtime, access.path, access.accessType, denyByDefault);
    if (reason) return reason;
  }
  return null;
}

export {ensureShellAllowed} from "./approval";
export {bashPathAccesses} from "./bash-paths";
