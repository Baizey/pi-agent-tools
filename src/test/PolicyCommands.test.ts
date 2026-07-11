import assert from "node:assert/strict";
import {AgentRuntime} from "../pi/runtime";
import {PathPolicyLogic} from "../policy/path/PathPolicyLogic";
import {ShellPolicyLogic} from "../policy/shell/ShellPolicyLogic";
import {CodeExecPolicyLogic} from "../policy/code-exec/CodeExecPolicyLogic";
import {WebPolicyLogic} from "../policy/web/WebPolicyLogic";
import {CodeExecMode, FsAccessType, PolicyLifetime, PolicyStatus, WebAccessType} from "../policy/types";
import {handlePolicyIoCommand} from "../extensions/policy/commands/io";
import {handlePolicyWebCommand} from "../extensions/policy/commands/web";
import {handlePolicyCodeCommand} from "../extensions/policy/commands/code";
import {handlePolicyShellCommand} from "../extensions/policy/commands/shell";
import {handlePolicyCommand} from "../extensions/policy/commands/policy";
import {tokenizePolicyCommandArgs} from "../extensions/policy/commands/shared";
import {PolicyCommandAction, PolicyCommandKind, PolicyCommandLifetimeArg, PolicyCommandMessageKind, PolicyCommandOption, PolicyWildcard} from "../extensions/policy/commands/types";

class FakeStore<TPolicy> {
  saveCount = 0;
  save(_policy: TPolicy): void {
    this.saveCount++;
  }
}

type TestRuntime = Omit<AgentRuntime, "pathPolicyStore" | "shellPolicyStore" | "codeExecPolicyStore" | "webPolicyStore"> & {
  pathPolicyStore: FakeStore<PathPolicyLogic>;
  shellPolicyStore: FakeStore<ShellPolicyLogic>;
  codeExecPolicyStore: FakeStore<CodeExecPolicyLogic>;
  webPolicyStore: FakeStore<WebPolicyLogic>;
};

function runtime(): TestRuntime {
  const pathPolicy = new PathPolicyLogic({standardizePath: (input) => input});
  const shellPolicy = new ShellPolicyLogic();
  const codeExecPolicy = new CodeExecPolicyLogic();
  const webPolicy = new WebPolicyLogic();
  return {
    pathPolicy,
    pathPolicyStore: new FakeStore<PathPolicyLogic>(),
    shellPolicy,
    shellPolicyStore: new FakeStore<ShellPolicyLogic>(),
    codeExecPolicy,
    codeExecPolicyStore: new FakeStore<CodeExecPolicyLogic>(),
    webPolicy,
    webPolicyStore: new FakeStore<WebPolicyLogic>(),
  };
}

function agentRuntime(rt: TestRuntime): AgentRuntime {
  return rt as unknown as AgentRuntime;
}

function assertPolicyOutputIsNotJson(message: string): void {
  assert.doesNotMatch(message, /pathPolicies|shellPolicies|codeExecPolicies|webPolicies/);
  assert.doesNotMatch(message, /^\s*[\[{]/);
  assert.doesNotMatch(message, /^\s*-/m);
}

test("policy command tokenizer preserves Windows path backslashes", () => {
  assert.deepEqual(tokenizePolicyCommandArgs(`${PolicyCommandAction.ALLOW} C:\\Users\\me\\repo ${FsAccessType.READ}`), [
    PolicyCommandAction.ALLOW,
    "C:\\Users\\me\\repo",
    FsAccessType.READ,
  ]);
  assert.deepEqual(tokenizePolicyCommandArgs(`${PolicyCommandAction.ALLOW} "C:\\Users\\me\\repo with spaces" ${FsAccessType.READ}`), [
    PolicyCommandAction.ALLOW,
    "C:\\Users\\me\\repo with spaces",
    FsAccessType.READ,
  ]);
});

test("policy-io rejects bare lifetime option", () => {
  const rt = runtime();
  const result = handlePolicyIoCommand(agentRuntime(rt), `${PolicyCommandAction.ALLOW} ./src ${FsAccessType.READ} ${PolicyCommandOption.LIFETIME}`);
  assert.equal(result.kind, PolicyCommandMessageKind.ERROR);
});

test("policy-io allow deny remove and clear mutate path policy through logic", () => {
  const rt = runtime();

  const ar = agentRuntime(rt);
  let result = handlePolicyIoCommand(ar, `${PolicyCommandAction.ALLOW} ./src ${FsAccessType.READ} ${PolicyCommandOption.LIFETIME} ${PolicyCommandLifetimeArg.FOREVER}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.equal(rt.pathPolicyStore.saveCount, 1);
  assert.equal(rt.pathPolicy.evaluate("./src/file.ts", FsAccessType.READ)?.matchedStatus, PolicyStatus.ALLOWED);
  assert.equal(rt.pathPolicy.evaluate("./src/file.ts", FsAccessType.WRITE, false), null);

  result = handlePolicyIoCommand(ar, `${PolicyCommandAction.DENY} ./src ${FsAccessType.WRITE}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.equal(rt.pathPolicy.evaluate("./src/file.ts", FsAccessType.WRITE)?.matchedStatus, PolicyStatus.DENIED);

  result = handlePolicyIoCommand(ar, `${PolicyCommandAction.REMOVE} ./src ${FsAccessType.READ}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.equal(rt.pathPolicy.evaluate("./src/file.ts", FsAccessType.READ, false), null);
  assert.equal(rt.pathPolicyStore.saveCount, 2);

  result = handlePolicyIoCommand(ar, `${PolicyCommandAction.CLEAR}`);
  assert.equal(result.kind, PolicyCommandMessageKind.ERROR);
  result = handlePolicyIoCommand(ar, `${PolicyCommandAction.CLEAR} ${PolicyCommandOption.YES}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.deepEqual(rt.pathPolicy.policiesSnapshot(), []);
});

test("policy-io refuses session policy that would shadow forever policy", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  let result = handlePolicyIoCommand(ar, `${PolicyCommandAction.ALLOW} ./src ${FsAccessType.READ} ${PolicyCommandOption.LIFETIME} ${PolicyCommandLifetimeArg.FOREVER}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);

  result = handlePolicyIoCommand(ar, `${PolicyCommandAction.DENY} ./src ${FsAccessType.READ}`);
  assert.equal(result.kind, PolicyCommandMessageKind.ERROR);
  assert.equal(rt.pathPolicy.evaluate("./src/file.ts", FsAccessType.READ)?.matchedStatus, PolicyStatus.ALLOWED);
});

test("policy-web manages URL policies by normalized host path and access type", () => {
  const rt = runtime();

  const ar = agentRuntime(rt);
  const result = handlePolicyWebCommand(ar, `${PolicyCommandAction.ALLOW} https://www.Example.com/docs/page ${WebAccessType.READ} ${PolicyCommandOption.LIFETIME}=${PolicyCommandLifetimeArg.FOREVER}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.equal(rt.webPolicyStore.saveCount, 1);

  const evalResult = rt.webPolicy.evaluate("https://example.com/docs/page/child", WebAccessType.READ);
  assert.equal(evalResult?.matchedStatus, PolicyStatus.ALLOWED);
  assert.equal(evalResult?.matchedHost, "example.com");
  assert.equal(evalResult?.matchedPath, "/docs/page");

  handlePolicyWebCommand(ar, `${PolicyCommandAction.REMOVE} https://example.com/docs/page ${WebAccessType.READ}`);
  assert.equal(rt.webPolicy.evaluate("https://example.com/docs/page/child", WebAccessType.READ, false), null);
  assert.equal(rt.webPolicyStore.saveCount, 2);
});

test("policy-code manages explicit code execution policies", () => {
  const rt = runtime();

  const ar = agentRuntime(rt);
  const result = handlePolicyCodeCommand(ar, `${PolicyCommandAction.DENY} JavaScript ${CodeExecMode.INLINE} ${PolicyCommandOption.LIFETIME} ${PolicyCommandLifetimeArg.FOREVER}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.equal(rt.codeExecPolicyStore.saveCount, 1);
  assert.equal(rt.codeExecPolicy.evaluate("javascript", CodeExecMode.INLINE)?.matchedStatus, PolicyStatus.DENIED);

  handlePolicyCodeCommand(ar, `${PolicyCommandAction.ALLOW} ${PolicyWildcard.ALL} ${CodeExecMode.FILE}`);
  assert.equal(rt.codeExecPolicy.evaluate("python", CodeExecMode.FILE)?.matchedStatus, PolicyStatus.ALLOWED);

  handlePolicyCodeCommand(ar, `${PolicyCommandAction.REMOVE} javascript ${CodeExecMode.INLINE}`);
  assert.equal(rt.codeExecPolicy.evaluate("javascript", CodeExecMode.INLINE, false), null);
  assert.equal(rt.codeExecPolicyStore.saveCount, 2);
});

test("policy-shell infers command flags and supports flag removal", () => {
  const rt = runtime();

  const ar = agentRuntime(rt);
  let result = handlePolicyShellCommand(ar, `${PolicyCommandAction.ALLOW} git status --short ${PolicyCommandOption.LIFETIME} ${PolicyCommandLifetimeArg.FOREVER}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.equal(rt.shellPolicyStore.saveCount, 1);

  let evaluated = rt.shellPolicy.evaluate("git status --short");
  assert.equal(evaluated?.allowed, true);

  result = handlePolicyShellCommand(ar, `${PolicyCommandAction.REMOVE} git status ${PolicyCommandOption.FLAG} --short`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  evaluated = rt.shellPolicy.evaluate("git status --short", false);
  assert.equal(evaluated, null);
  assert.equal(rt.shellPolicyStore.saveCount, 2);
});

test("policy-shell rejects unsafe multi-segment command policies", () => {
  const rt = runtime();
  const result = handlePolicyShellCommand(agentRuntime(rt), `${PolicyCommandAction.ALLOW} git status && npm test`);
  assert.equal(result.kind, PolicyCommandMessageKind.ERROR);
  assert.deepEqual(rt.shellPolicy.policiesSnapshot(), []);
});

test("policy-shell flag allow can replace an existing command deny", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  handlePolicyShellCommand(ar, `${PolicyCommandAction.DENY} git status`);
  const result = handlePolicyShellCommand(ar, `${PolicyCommandAction.ALLOW} git status ${PolicyCommandOption.FLAG} --short`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.equal(rt.shellPolicy.evaluate("git status --short")?.allowed, true);
});

test("policy-shell refuses session flag allow that would shadow forever command deny", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  handlePolicyShellCommand(ar, `${PolicyCommandAction.DENY} git status ${PolicyCommandOption.LIFETIME} ${PolicyCommandLifetimeArg.FOREVER}`);
  const result = handlePolicyShellCommand(ar, `${PolicyCommandAction.ALLOW} git status ${PolicyCommandOption.FLAG} --short`);
  assert.equal(result.kind, PolicyCommandMessageKind.ERROR);
  assert.equal(rt.shellPolicy.evaluate("git status")?.denied, true);
});

test("policy-shell forever flags upgrade a session command for persistence", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  handlePolicyShellCommand(ar, `${PolicyCommandAction.ALLOW} git status`);
  const result = handlePolicyShellCommand(ar, `${PolicyCommandAction.DENY} git status ${PolicyCommandOption.FLAG} --short ${PolicyCommandOption.LIFETIME} ${PolicyCommandLifetimeArg.FOREVER}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  const persisted = rt.shellPolicy.persistedPolicies();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].lifetime, PolicyLifetime.FOREVER);
  assert.equal(persisted[0].flags["--short"].lifetime, PolicyLifetime.FOREVER);
});

test("policy-shell removing last synthetic flag removes synthetic command allow", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  handlePolicyShellCommand(ar, `${PolicyCommandAction.DENY} git status ${PolicyCommandOption.FLAG} --short`);
  const result = handlePolicyShellCommand(ar, `${PolicyCommandAction.REMOVE} git status ${PolicyCommandOption.FLAG} --short`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.deepEqual(rt.shellPolicy.policiesSnapshot(), []);
});

test("policy-shell flag deny does not deny the command itself", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  let result = handlePolicyShellCommand(ar, `${PolicyCommandAction.DENY} git status ${PolicyCommandOption.FLAG} --short`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);

  let evaluated = rt.shellPolicy.evaluate("git status");
  assert.equal(evaluated?.allowed, true);
  evaluated = rt.shellPolicy.evaluate("git status --short");
  assert.equal(evaluated?.denied, true);
});

test("clear commands reject scoped operands until scoped clear exists", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  handlePolicyIoCommand(ar, `${PolicyCommandAction.ALLOW} ./src ${FsAccessType.READ}`);
  const result = handlePolicyIoCommand(ar, `${PolicyCommandAction.CLEAR} ./src ${PolicyCommandOption.YES}`);
  assert.equal(result.kind, PolicyCommandMessageKind.ERROR);
  assert.notDeepEqual(rt.pathPolicy.policiesSnapshot(), []);
});

test("clear commands reject empty reason option", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  handlePolicyIoCommand(ar, `${PolicyCommandAction.ALLOW} ./src ${FsAccessType.READ}`);
  const result = handlePolicyIoCommand(ar, `${PolicyCommandAction.CLEAR} ${PolicyCommandOption.YES} ${PolicyCommandOption.REASON}=`);
  assert.equal(result.kind, PolicyCommandMessageKind.ERROR);
  assert.notDeepEqual(rt.pathPolicy.policiesSnapshot(), []);
});

test("policy show and eval outputs are concise text, not JSON", () => {
  const rt = runtime();
  const ar = agentRuntime(rt);
  handlePolicyIoCommand(ar, `${PolicyCommandAction.ALLOW} ./src ${FsAccessType.READ} ${FsAccessType.WRITE} ${FsAccessType.EDIT}`);
  handlePolicyIoCommand(ar, `${PolicyCommandAction.DENY} ./src ${FsAccessType.EXECUTE}`);
  handlePolicyWebCommand(ar, `${PolicyCommandAction.ALLOW} https://example.com/docs ${WebAccessType.READ}`);
  handlePolicyCodeCommand(ar, `${PolicyCommandAction.DENY} javascript ${CodeExecMode.INLINE}`);
  handlePolicyShellCommand(ar, `${PolicyCommandAction.ALLOW} git status --short`);

  const ioShow = handlePolicyIoCommand(ar, PolicyCommandAction.SHOW);
  assert.match(ioShow.message, /IO policies\n  \.\/src\n    ALLOWED\n      READ, WRITE, EDIT \(session\)\n    DENIED\n      EXECUTE \(session\)/);
  assertPolicyOutputIsNotJson(ioShow.message);

  const ioEval = handlePolicyIoCommand(ar, `${PolicyCommandAction.EVAL} ./src/file.ts ${FsAccessType.READ}`);
  assert.match(ioEval.message, /IO evaluation \.\/src\/file\.ts\n  READ ALLOWED via \.\/src \(session\)/);
  assertPolicyOutputIsNotJson(ioEval.message);

  const shellEval = handlePolicyShellCommand(ar, `${PolicyCommandAction.EVAL} git status --short`);
  assert.match(shellEval.message, /Shell evaluation git status --short\n  result ALLOWED/);
  assert.match(shellEval.message, /    flag --short ALLOWED \(session\)/);
  assertPolicyOutputIsNotJson(shellEval.message);

  const allShow = handlePolicyCommand(ar, `${PolicyCommandAction.SHOW} ${PolicyCommandKind.ALL}`);
  assert.match(allShow.message, /IO policies/);
  assert.match(allShow.message, /Shell policies/);
  assert.match(allShow.message, /Code execution policies/);
  assert.match(allShow.message, /Web policies/);
  assertPolicyOutputIsNotJson(allShow.message);
});

test("policy umbrella shows and clears all explicit policy kinds", () => {
  const rt = runtime();

  const ar = agentRuntime(rt);
  handlePolicyIoCommand(ar, `${PolicyCommandAction.ALLOW} ./src ${FsAccessType.READ}`);
  handlePolicyWebCommand(ar, `${PolicyCommandAction.ALLOW} https://example.com ${WebAccessType.READ}`);
  handlePolicyCodeCommand(ar, `${PolicyCommandAction.ALLOW} python ${CodeExecMode.INLINE}`);
  handlePolicyShellCommand(ar, `${PolicyCommandAction.ALLOW} npm test`);

  let result = handlePolicyCommand(ar, `${PolicyCommandAction.CLEAR} ${PolicyCommandKind.ALL}`);
  assert.equal(result.kind, PolicyCommandMessageKind.ERROR);

  result = handlePolicyCommand(ar, `${PolicyCommandAction.CLEAR} ${PolicyCommandKind.ALL} ${PolicyCommandOption.YES}`);
  assert.equal(result.kind, PolicyCommandMessageKind.INFO);
  assert.deepEqual(rt.pathPolicy.policiesSnapshot(), []);
  assert.deepEqual(rt.webPolicy.policiesSnapshot(), []);
  assert.deepEqual(rt.codeExecPolicy.policiesSnapshot(), []);
  assert.deepEqual(rt.shellPolicy.policiesSnapshot(), []);
});
