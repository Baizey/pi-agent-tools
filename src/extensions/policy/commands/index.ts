import {PiExtensionApi} from "../../../pi/types";
import {AgentServices} from "../../../pi/runtime";
import {registerPolicyCodeCommand} from "./code";
import {registerPolicyIoCommand} from "./io";
import {registerPolicyCommand} from "./policy";
import {registerPolicyShellCommand} from "./shell";
import {registerPolicyWebCommand} from "./web";

export function registerPolicyCommands(pi: PiExtensionApi, services: AgentServices): void {
  registerPolicyCommand(pi, services);
  registerPolicyIoCommand(pi, services);
  registerPolicyShellCommand(pi, services);
  registerPolicyCodeCommand(pi, services);
  registerPolicyWebCommand(pi, services);
}

export * from "./types";
export * from "./shared";
export * from "./io";
export * from "./web";
export * from "./code";
export * from "./shell";
export * from "./policy";
