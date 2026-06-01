import {PiExtensionApi} from "./pi/types";
import {createServices} from "./pi/runtime";
import {registerDeleteTool} from "./extensions/delete";
import {registerFileTools} from "./extensions/file-tools";
import {registerPathPolicy} from "./extensions/path-policy";
import {registerPolicyInfoTool} from "./extensions/policy-info";
import {registerShellPolicy} from "./extensions/shell-policy";

export default function piDevExtension(pi: PiExtensionApi): void {
  const services = createServices();

  registerDeleteTool(pi);
  registerFileTools(pi);
  registerPolicyInfoTool(pi, services);
  registerShellPolicy(pi, services);
  registerPathPolicy(pi, services);
}
