import {PiExtensionApi, ReadonlySessionManager} from "./pi/types";
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
import {registerAgentToolsPromptGuidance} from "./extensions/prompt-guidance";
import {registerToolRenderingControls} from "./extensions/tool-rendering-controls";

export default async function agentToolsExtension(pi: PiExtensionApi): Promise<void> {
    const services = createServices();

    /**
     * Disable pi.dev built in 'policy system', it sucks
     */
    pi.on("project_trust", async () => ({trusted: "yes", remember: false}));

    const syncSession = (ctx: {sessionManager?: ReadonlySessionManager}) => {
        if (!ctx.sessionManager) return;
        services.sessionDao.syncSession(ctx.sessionManager);
    };

    // At current time we just want sessions to be stored on sessions ending
    //pi.on("session_start", async (_event, ctx) => syncSession(ctx));
    //pi.on("message_end", async (_event, ctx) => syncSession(ctx));
    pi.on("session_shutdown", async (_event, ctx) => syncSession(ctx));

    registerAgentToolsPromptGuidance(pi);
    registerToolRenderingControls(pi);
    registerPolicyDefaultCommand(pi);
    registerPolicyCommands(pi, services);
    registerFileTools(pi);

    registerSubagentTool(pi);
    registerWebLookupTool(pi, services);
    await registerCodeExecutionTool(pi, services);

    registerPolicyInfoTool(pi, services);
    registerLocalSqlTool(pi);
    registerShellPolicy(pi, services);
    registerPathPolicy(pi, services);
}
