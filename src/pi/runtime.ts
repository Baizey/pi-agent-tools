import os from "node:os";
import path from "node:path";
import {PathPolicyLogic} from "../policy/path/PathPolicyLogic";
import {PathPolicyLogicStore} from "../policy/path/PathPolicyLogicStore";
import {CodeExecPolicyLogic} from "../policy/code-exec/CodeExecPolicyLogic";
import {CodeExecPolicyLogicStore} from "../policy/code-exec/CodeExecPolicyLogicStore";
import {ShellPolicyLogic} from "../policy/shell/ShellPolicyLogic";
import {ShellPolicyLogicStore} from "../policy/shell/ShellPolicyLogicStore";
import {WebPolicyLogic} from "../policy/web/WebPolicyLogic";
import {WebPolicyLogicStore} from "../policy/web/WebPolicyLogicStore";
import {standardizePath} from "../shared/paths";
import {
  CodeExecPolicyDao,
  database_filename,
  PathPolicyDao,
  SessionDao,
  ShellPolicyDao,
  SqliteDatabase,
  SubagentDao,
  WebPolicyDao,
} from "../storage";

export type AgentRuntime = {
  pathPolicy: PathPolicyLogic;
  pathPolicyStore: PathPolicyLogicStore;
  shellPolicy: ShellPolicyLogic;
  shellPolicyStore: ShellPolicyLogicStore;
  codeExecPolicy: CodeExecPolicyLogic;
  codeExecPolicyStore: CodeExecPolicyLogicStore;
  webPolicy: WebPolicyLogic;
  webPolicyStore: WebPolicyLogicStore;
};

export type AgentServices = {
  sessionDao: SessionDao;
  subagentDao: SubagentDao;
  runtimeFor(cwd: string): AgentRuntime;
};

export function createServices(): AgentServices {
  const runtimes = new Map<string, AgentRuntime>();
  const agentDb = SqliteDatabase.readwrite(database_filename);
  const sessionDao = new SessionDao(agentDb).initializeSchema();
  const subagentDao = new SubagentDao(agentDb).initializeSchema();
  const pathPolicyDao = new PathPolicyDao(agentDb).initializeSchema();
  const shellPolicyDao = new ShellPolicyDao(agentDb).initializeSchema();
  const codeExecPolicyDao = new CodeExecPolicyDao(agentDb).initializeSchema();
  const webPolicyDao = new WebPolicyDao(agentDb).initializeSchema();

  return {
    sessionDao,
    subagentDao,
    runtimeFor(cwd: string): AgentRuntime {
      const key = path.resolve(cwd);
      const existing = runtimes.get(key);
      if (existing) return existing;

      const userPiDir = path.join(os.homedir(), ".pi", "agent");
      const pathPolicyStore = new PathPolicyLogicStore(pathPolicyDao, path.join(userPiDir, "path-policy.json"));
      const shellPolicyStore = new ShellPolicyLogicStore(shellPolicyDao, path.join(userPiDir, "shell-policy.json"));
      const codeExecPolicyStore = new CodeExecPolicyLogicStore(codeExecPolicyDao, path.join(userPiDir, "code-exec-policy.json"));
      const webPolicyStore = new WebPolicyLogicStore(webPolicyDao, path.join(userPiDir, "web-policy.json"));
      const pathPolicy = new PathPolicyLogic({standardizePath: (input) => standardizePath(key, input)});
      const shellPolicy = new ShellPolicyLogic();
      const codeExecPolicy = new CodeExecPolicyLogic();
      const webPolicy = new WebPolicyLogic();

      pathPolicyStore.loadInto(pathPolicy);
      shellPolicyStore.loadInto(shellPolicy);
      codeExecPolicyStore.loadInto(codeExecPolicy);
      webPolicyStore.loadInto(webPolicy);

      const runtime: AgentRuntime = {
        pathPolicy,
        pathPolicyStore,
        shellPolicy,
        shellPolicyStore,
        codeExecPolicy,
        codeExecPolicyStore,
        webPolicy,
        webPolicyStore,
      };
      runtimes.set(key, runtime);
      return runtime;
    },
  };
}
