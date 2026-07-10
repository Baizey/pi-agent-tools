import assert from "node:assert/strict";
import {registerCodeExecutionTool} from "../extensions/tools/code-exec";
import {FsAccessType, PolicyLifetime, PolicyStatus} from "../policy/types";
import type {PiExtensionApi, ToolDefinition} from "../pi/types";

async function registeredExecuteCodeTool(deny: {path: string; accessType: FsAccessType}) {
  let tool: ToolDefinition | undefined;
  const accesses: Array<{path: string; accessType: FsAccessType; denyByDefault: boolean}> = [];
  const pi = {
    on() {},
    registerTool(definition: ToolDefinition) {
      if (definition.name === "execute_code") tool = definition;
    },
  } satisfies PiExtensionApi;

  await registerCodeExecutionTool(pi, {
    sessionDao: {} as never,
    subagentDao: {} as never,
    runtimeFor: () => ({
      pathPolicy: {
        evaluate(path: string, accessType: FsAccessType, denyByDefault: boolean) {
          accesses.push({path, accessType, denyByDefault});
          return {
            evaluatedPath: path,
            evaluatedAccessType: accessType,
            matchedPattern: path,
            matchedLifetime: PolicyLifetime.SESSION,
            matchedStatus: deny.path === path && deny.accessType === accessType ? PolicyStatus.DENIED : PolicyStatus.ALLOWED,
            matchedReason: deny.path === path && deny.accessType === accessType ? "path denied for test" : "path allowed for test",
          };
        },
        toDenyReasonOrNull(result: {matchedStatus: PolicyStatus; matchedReason: string}) {
          return result.matchedStatus === PolicyStatus.ALLOWED ? null : result.matchedReason;
        },
      },
      codeExecPolicy: {
        evaluate: () => ({
          language: "javascript",
          mode: "inline",
          matchedLanguage: "javascript",
          matchedMode: "inline",
          matchedScope: "javascript inline",
          matchedLifetime: PolicyLifetime.SESSION,
          matchedStatus: PolicyStatus.ALLOWED,
          matchedReason: "code allowed for test",
        }),
        toDenyReasonOrNull: () => null,
        removePolicies: () => {},
      },
    } as never),
  });

  assert.ok(tool);
  return {tool, accesses};
}

test("execute_code blocks before execution when cwd EXECUTE path policy denies", async () => {
  const cwd = process.cwd();
  const {tool, accesses} = await registeredExecuteCodeTool({path: cwd, accessType: FsAccessType.EXECUTE});

  const result = await tool.execute("code", {language: "javascript", code: "process.stdout.write('should not run')", cwd}, undefined, undefined, {cwd, hasUI: false});

  assert.equal(result.isError, true);
  assert.match((result.content[0] as {text: string}).text, /path denied for test/);
  assert.deepEqual(accesses.map((it) => [it.path, it.accessType]), [[cwd, FsAccessType.EXECUTE]]);
});

test("execute_code file mode checks source READ and EXECUTE before code policy/execution", async () => {
  const cwd = process.cwd();
  const {tool, accesses} = await registeredExecuteCodeTool({path: "script.js", accessType: FsAccessType.EXECUTE});

  const result = await tool.execute("code", {language: "javascript", file: "script.js", cwd}, undefined, undefined, {cwd, hasUI: false});

  assert.equal(result.isError, true);
  assert.match((result.content[0] as {text: string}).text, /path denied for test/);
  assert.deepEqual(accesses.map((it) => [it.path, it.accessType]), [
    [cwd, FsAccessType.EXECUTE],
    ["script.js", FsAccessType.READ],
    ["script.js", FsAccessType.EXECUTE],
  ]);
});
