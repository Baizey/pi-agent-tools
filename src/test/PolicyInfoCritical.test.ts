import assert from "node:assert/strict";
import {test} from "./TestHarness";
import {registerPolicyInfoTool} from "../extensions/tools/policy-info";
import {FsAccessType, PolicyLifetime, PolicyStatus, WebAccessType} from "../policy/types";
import type {PiExtensionApi, ToolDefinition} from "../pi/types";

function registeredPolicyInfoTool() {
  let tool: ToolDefinition | undefined;
  let runtimeCwd: string | undefined;
  const pi = {
    on() {},
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } satisfies PiExtensionApi;

  registerPolicyInfoTool(pi, {
    runtimeFor: (cwd: string) => {
      runtimeCwd = cwd;
      return {
        pathPolicy: {
          policiesSnapshot: () => [],
          evaluate: (target: string, accessType: FsAccessType) => target === "allowed.txt"
            ? {
              evaluatedPath: target,
              evaluatedAccessType: accessType,
              matchedPattern: target,
              matchedLifetime: PolicyLifetime.SESSION,
              matchedStatus: PolicyStatus.ALLOWED,
              matchedReason: "path allowed",
            }
            : null,
        },
        shellPolicy: {
          policiesSnapshot: () => [],
          evaluate: (command: string) => command === "git status" ? {command, segmentResults: [], allowed: true, denied: false} : null,
          pendingPolicyScopeOptions: (command: string) => [{label: command.split(" ")[0], commandArgs: [command.split(" ")[0]], flags: []}],
        },
        codeExecPolicy: {
          policiesSnapshot: () => [],
          evaluate: (language: string, mode: string) => language === "python" && mode === "inline"
            ? {
              language,
              mode,
              matchedLanguage: language,
              matchedMode: mode,
              matchedScope: `${language} ${mode}`,
              matchedLifetime: PolicyLifetime.SESSION,
              matchedStatus: PolicyStatus.ALLOWED,
              matchedReason: "code allowed",
            }
            : null,
          pendingPolicyScopeOptions: (language: string, mode: string) => [{label: `${language} ${mode}`, language, mode}],
        },
        webPolicy: {
          policiesSnapshot: () => [],
          evaluate: (url: string, accessType: WebAccessType) => url === "https://example.com/"
            ? {
              url,
              accessType,
              host: "example.com",
              path: "/",
              matchedHost: "example.com",
              matchedPath: "/",
              matchedScope: "https://example.com/",
              matchedLifetime: PolicyLifetime.SESSION,
              matchedStatus: PolicyStatus.ALLOWED,
              matchedReason: "web allowed",
            }
            : null,
          pendingPolicyScopeOptions: (url: string, accessType: WebAccessType) => [{label: `${accessType} example`, host: "example.com", path: "/", accessType}],
        },
      } as never;
    },
  });

  assert.ok(tool);
  return {tool, getRuntimeCwd: () => runtimeCwd};
}

test("policy_info path reports unknown for unmatched paths and all access types by default", async () => {
  const {tool} = registeredPolicyInfoTool();

  const result = await tool.execute("policy", {kind: "path", path: "missing.txt"});

  assert.equal(result.isError, undefined);
  const details = result.details as {evaluations: Array<{evaluatedAccessType: FsAccessType; matchedStatus: string}>};
  assert.equal(details.evaluations.length, 5);
  assert.deepEqual(new Set(details.evaluations.map((it) => it.evaluatedAccessType)), new Set(Object.values(FsAccessType)));
  assert.ok(details.evaluations.every((it) => it.matchedStatus === "UNKNOWN"));
});

test("policy_info code includes cwd and file path checks", async () => {
  const {tool, getRuntimeCwd} = registeredPolicyInfoTool();

  const result = await tool.execute("policy", {kind: "code", language: "python", mode: "file", cwd: "custom-cwd", file: "script.py"});

  assert.equal(result.isError, undefined);
  assert.equal(getRuntimeCwd(), "custom-cwd");
  const details = result.details as {pathChecks: Array<{target: string; accessType: FsAccessType}>};
  assert.deepEqual(details.pathChecks.map((it) => [it.target, it.accessType]), [
    ["custom-cwd", FsAccessType.EXECUTE],
    ["script.py", FsAccessType.READ],
    ["script.py", FsAccessType.EXECUTE],
  ]);
});

test("policy_info web validates access type and evaluates READ and SEARCH by default", async () => {
  const {tool} = registeredPolicyInfoTool();

  const invalid = await tool.execute("policy", {kind: "web", url: "https://example.com/", accessType: "WRITE"});
  assert.equal(invalid.isError, true);

  const result = await tool.execute("policy", {kind: "web", url: "https://example.org/"});
  assert.equal(result.isError, undefined);
  const details = result.details as {evaluations: Array<{accessType: WebAccessType; status: string}>};
  assert.deepEqual(new Set(details.evaluations.map((it) => it.accessType)), new Set(Object.values(WebAccessType)));
  assert.ok(details.evaluations.every((it) => it.status === "UNKNOWN"));
});
