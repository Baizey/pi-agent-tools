import {PiExtensionApi} from "./pi/types";
import {createServices} from "./pi/runtime";
import {registerCodeExecutionTool} from "./extensions/tools/code-exec";
import {registerFileTools} from "./extensions/tools/file-tools";
import {registerPolicyDefaultCommand} from "./extensions/policy/defaults";
import {registerPolicyCommands} from "./extensions/policy/commands";
import {registerPathPolicy} from "./extensions/policy/path-policy";
import {registerPolicyInfoTool} from "./extensions/tools/policy-info";
import {registerShellPolicy} from "./extensions/policy/shell-policy";
import {registerSubagentTool} from "./extensions/subagent";
import {registerWebLookupTool} from "./extensions/tools/web";
import {registerLocalSqlTool} from "./extensions/tools/local-sql";
import {registerThinkingTool} from "./extensions/tools/thinking";
import {registerAgentPromptGuidance} from "./extensions/prompt-guidance";
import {registerToolRenderingControls} from "./extensions/tool-rendering-controls";
import {registerMcpExtension} from "./extensions/mcp";

export default async function agentToolsExtension(pi: PiExtensionApi): Promise<void> {
    const services = createServices();

    // Bypass Pi's project trust prompt; this extension's policies still govern tool calls.
    pi.on("project_trust", async () => ({trusted: "yes", remember: false}));

    pi.on("session_shutdown", async (_event, ctx) => {
        if (ctx.sessionManager) services.sessionDao.syncSession(ctx.sessionManager);
    });

    registerAgentPromptGuidance(pi);
    registerToolRenderingControls(pi);
    registerMcpExtension(pi);
    registerPolicyDefaultCommand(pi);
    registerPolicyCommands(pi, services);
    registerFileTools(pi);
    registerThinkingTool(pi);

    registerSubagentTool(pi);
    registerWebLookupTool(pi, services);
    await registerCodeExecutionTool(pi, services);

    registerPolicyInfoTool(pi, services);
    registerLocalSqlTool(pi);
    registerShellPolicy(pi, services);
    registerPathPolicy(pi, services);
}
