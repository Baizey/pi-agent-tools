import assert from "node:assert/strict";
import {test} from "./TestHarness";
import {FsAccessType, PolicyLifetime, PolicyStatus, registerPathPolicy} from "../index";
import type {PiExtensionApi, ToolCallEvent, ToolCallDecision, ExtensionContext} from "../index";

type CapturedAccess = {path: string; accessType: FsAccessType; denyByDefault: boolean};

function capturePathHook(denied?: {path: string; accessType: FsAccessType}) {
  let handler: ((event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallDecision | void> | ToolCallDecision | void) | undefined;
  const accesses: CapturedAccess[] = [];
  const pi = {
    on(event: "tool_call", callback: typeof handler) {
      if (event === "tool_call") handler = callback;
    },
  } as PiExtensionApi;
  const runtime = {
    pathPolicy: {
      evaluate(path: string, accessType: FsAccessType, denyByDefault: boolean) {
        accesses.push({path, accessType, denyByDefault});
        if (denied && denied.path === path && denied.accessType === accessType) {
          return {
            evaluatedPath: path,
            evaluatedAccessType: accessType,
            matchedPattern: path,
            matchedLifetime: PolicyLifetime.SESSION,
            matchedStatus: PolicyStatus.DENIED,
            matchedReason: "denied for test",
          };
        }
        return {
          evaluatedPath: path,
          evaluatedAccessType: accessType,
          matchedPattern: path,
          matchedLifetime: PolicyLifetime.SESSION,
          matchedStatus: PolicyStatus.ALLOWED,
          matchedReason: "allowed for test",
        };
      },
      toDenyReasonOrNull(result: {matchedStatus: PolicyStatus; matchedReason: string}) {
        return result.matchedStatus === PolicyStatus.ALLOWED ? null : result.matchedReason;
      },
    },
  };
  registerPathPolicy(pi, {sessionDao: {} as never, subagentDao: {} as never, runtimeFor: () => runtime as never});
  assert.ok(handler);
  return {handler, accesses};
}

test("path policy hook maps multi-path filesystem tools to critical access types", async () => {
  const {handler, accesses} = capturePathHook();
  const ctx = {cwd: process.cwd(), hasUI: false};

  await handler({toolName: "copy", input: {from: "source.txt", to: "dest.txt"}}, ctx);
  await handler({toolName: "move", input: {from: "old.txt", to: "new.txt", overwrite: true}}, ctx);

  assert.deepEqual(accesses.map((it) => [it.path, it.accessType]), [
    ["source.txt", FsAccessType.READ],
    ["dest.txt", FsAccessType.WRITE],
    ["old.txt", FsAccessType.DELETE],
    ["new.txt", FsAccessType.WRITE],
    ["new.txt", FsAccessType.DELETE],
  ]);
});

test("path policy hook blocks immediately when any mapped access is denied", async () => {
  const {handler, accesses} = capturePathHook({path: "dest.txt", accessType: FsAccessType.WRITE});

  const decision = await handler(
    {toolName: "copy", input: {from: "source.txt", to: "dest.txt"}},
    {cwd: process.cwd(), hasUI: false},
  );

  assert.deepEqual(accesses.map((it) => [it.path, it.accessType]), [
    ["source.txt", FsAccessType.READ],
    ["dest.txt", FsAccessType.WRITE],
  ]);
  assert.deepEqual(decision, {block: true, reason: "denied for test"});
});
