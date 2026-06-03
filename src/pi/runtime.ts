import os from "node:os";
import path from "node:path";
import {PathPolicyLogic} from "../policy/path/PathPolicyLogic";
import {PathPolicyLogicStore} from "../policy/path/PathPolicyLogicStore";
import {CodeExecPolicyLogic} from "../policy/code-exec/CodeExecPolicyLogic";
import {CodeExecPolicyLogicStore} from "../policy/code-exec/CodeExecPolicyLogicStore";
import {ShellPolicyLogic} from "../policy/shell/ShellPolicyLogic";
import {ShellPolicyLogicStore} from "../policy/shell/ShellPolicyLogicStore";
import {standardizePath} from "../shared/paths";

export type AgentRuntime = {
  pathPolicy: PathPolicyLogic;
  pathPolicyStore: PathPolicyLogicStore;
  shellPolicy: ShellPolicyLogic;
  shellPolicyStore: ShellPolicyLogicStore;
  codeExecPolicy: CodeExecPolicyLogic;
  codeExecPolicyStore: CodeExecPolicyLogicStore;
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
      const codeExecPolicyStore = new CodeExecPolicyLogicStore(path.join(userPiDir, "code-exec-policy.json"));
      const pathPolicy = new PathPolicyLogic({standardizePath: (input) => standardizePath(key, input)});
      const shellPolicy = new ShellPolicyLogic();
      const codeExecPolicy = new CodeExecPolicyLogic();

      pathPolicyStore.loadInto(pathPolicy);
      shellPolicyStore.loadInto(shellPolicy);
      codeExecPolicyStore.loadInto(codeExecPolicy);

      const runtime: AgentRuntime = {
        pathPolicy,
        pathPolicyStore,
        shellPolicy,
        shellPolicyStore,
        codeExecPolicy,
        codeExecPolicyStore,
      };
      runtimes.set(key, runtime);
      return runtime;
    },
  };
}
