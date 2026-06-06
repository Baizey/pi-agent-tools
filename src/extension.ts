import {PiExtensionApi} from "./pi/types";
import {createServices} from "./pi/runtime";
import {registerCodeExecutionTool} from "./extensions/tools/code-exec";
import {registerFileTools} from "./extensions/tools/file-tools";
import {registerPathPolicy} from "./extensions/policy/path-policy";
import {registerPolicyInfoTool} from "./extensions/tools/policy-info";
import {registerShellPolicy} from "./extensions/policy/shell-policy";
import {registerSubagentTool} from "./extensions/subagent";
import {registerWebLookupTool} from "./extensions/tools/web";

export default async function agentToolsExtension(pi: PiExtensionApi): Promise<void> {
    const services = createServices();

    registerFileTools(pi);

    registerSubagentTool(pi);
    registerWebLookupTool(pi, services);
    await registerCodeExecutionTool(pi, services);

    registerPolicyInfoTool(pi, services);
    registerShellPolicy(pi, services);
    registerPathPolicy(pi, services);
}
