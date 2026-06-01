import {PiExtensionApi} from "./pi/types";
import {createServices} from "./pi/runtime";
import {registerFileTools} from "./extensions/file-tools";
import {registerPathPolicy} from "./extensions/path-policy";
import {registerPolicyInfoTool} from "./extensions/policy-info";
import {registerShellPolicy} from "./extensions/shell-policy";
import {registerSubagentTool} from "./extensions/subagent";

export default function agentToolsExtension(pi: PiExtensionApi): void {
    const services = createServices();

    registerFileTools(pi);

    registerSubagentTool(pi);

    registerPolicyInfoTool(pi, services);
    registerShellPolicy(pi, services);
    registerPathPolicy(pi, services);
}
