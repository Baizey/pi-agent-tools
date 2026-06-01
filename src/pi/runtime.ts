import os from "node:os";
import path from "node:path";
import {PathPolicyLogic} from "../policy/path/PathPolicyLogic";
import {PathPolicyLogicStore} from "../policy/path/PathPolicyLogicStore";
import {ShellPolicyLogic} from "../policy/shell/ShellPolicyLogic";
import {ShellPolicyLogicStore} from "../policy/shell/ShellPolicyLogicStore";
import {standardizePath} from "../shared/paths";

export type AgentRuntime = {
  pathPolicy: PathPolicyLogic;
  pathPolicyStore: PathPolicyLogicStore;
  shellPolicy: ShellPolicyLogic;
  shellPolicyStore: ShellPolicyLogicStore;
};

export type AgentServices = {
  runtimeFor(cwd: string): AgentRuntime;
};

export function createServices(): AgentServices {
  const runtimes = new Map<string, AgentRuntime>();

  return {
    runtimeFor(cwd: string): AgentRuntime {
      const key = path.resolve(cwd);
      const existing = runtimes.get(key);
      if (existing) return existing;

      const userPiDir = path.join(os.homedir(), ".pi", "agent");
      const pathPolicyStore = new PathPolicyLogicStore(path.join(userPiDir, "path-policy.json"));
      const shellPolicyStore = new ShellPolicyLogicStore(path.join(userPiDir, "shell-policy.json"));
      const pathPolicy = new PathPolicyLogic({standardizePath: (input) => standardizePath(key, input)});
      const shellPolicy = new ShellPolicyLogic();

      pathPolicyStore.loadInto(pathPolicy);
      shellPolicyStore.loadInto(shellPolicy);

      const runtime: AgentRuntime = {
        pathPolicy,
        pathPolicyStore,
        shellPolicy,
        shellPolicyStore,
      };
      runtimes.set(key, runtime);
      return runtime;
    },
  };
}
