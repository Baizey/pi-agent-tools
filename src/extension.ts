import {PiExtensionApi} from "./pi/types";
import {createServices} from "./pi/runtime";
import {registerCodeExecutionTool} from "./extensions/code-exec";
import {registerFileTools} from "./extensions/file-tools";
import {registerPathPolicy} from "./extensions/path-policy";
import {registerPolicyInfoTool} from "./extensions/policy-info";
import {registerShellPolicy} from "./extensions/shell-policy";
import {registerSubagentTool} from "./extensions/subagent";

export default async function agentToolsExtension(pi: PiExtensionApi): Promise<void> {
    const services = createServices();

    registerFileTools(pi);

    registerSubagentTool(pi);
    await registerCodeExecutionTool(pi, services);

    registerPolicyInfoTool(pi, services);
    registerShellPolicy(pi, services);
    registerPathPolicy(pi, services);
}
