import {PiExtensionApi} from "./pi/types";
import {createServices} from "./pi/runtime";
import {registerPathPolicy} from "./extensions/path-policy";
import {registerShellPolicy} from "./extensions/shell-policy";

export default function piDevExtension(pi: PiExtensionApi): void {
  const services = createServices();

  registerShellPolicy(pi, services);
  registerPathPolicy(pi, services);
}
