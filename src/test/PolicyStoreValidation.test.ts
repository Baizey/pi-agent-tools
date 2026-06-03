import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CodeExecPolicyLogic,
  CodeExecPolicyLogicStore,
  FsAccessType,
  PathPolicyLogic,
  PathPolicyLogicStore,
  PolicyLifetime,
  PolicyStatus,
  ShellPolicyLogic,
  ShellPolicyLogicStore,
} from "../index";
import {tempDir, test} from "./TestHarness";

function tempFile(name: string): string {
  return path.join(tempDir("pi-agent-policy-store-"), name);
}

test("path policy store ignores malformed JSON instead of throwing", () => {
  const file = tempFile("path-policy.json");
  fs.writeFileSync(file, "{not json", "utf8");
  const logic = new PathPolicyLogic();

  assert.doesNotThrow(() => new PathPolicyLogicStore(file).loadInto(logic));
  assert.deepEqual(logic.policiesSnapshot(), []);
});

test("path policy store filters invalid policy entries", () => {
  const file = tempFile("path-policy.json");
  fs.writeFileSync(file, JSON.stringify({
    policies: [
      {path: "", info: {}},
      {path: "allowed", info: {[FsAccessType.READ]: {accessType: FsAccessType.READ, status: PolicyStatus.ALLOWED, lifetime: PolicyLifetime.FOREVER, reason: "ok"}}},
      {path: "bad", info: {[FsAccessType.READ]: {accessType: FsAccessType.READ, status: "MAYBE", lifetime: PolicyLifetime.FOREVER, reason: "bad"}}},
    ],
  }), "utf8");
  const logic = new PathPolicyLogic();

  new PathPolicyLogicStore(file).loadInto(logic);

  assert.equal(logic.policiesSnapshot().length, 1);
});

test("shell policy store ignores malformed JSON instead of throwing", () => {
  const file = tempFile("shell-policy.json");
  fs.writeFileSync(file, "{not json", "utf8");
  const logic = new ShellPolicyLogic();

  assert.doesNotThrow(() => new ShellPolicyLogicStore(file).loadInto(logic));
  assert.deepEqual(logic.policiesSnapshot(), []);
});

test("code execution policy store ignores malformed JSON instead of throwing", () => {
  const file = tempFile("code-policy.json");
  fs.writeFileSync(file, "{not json", "utf8");
  const logic = new CodeExecPolicyLogic();

  assert.doesNotThrow(() => new CodeExecPolicyLogicStore(file).loadInto(logic));
  assert.deepEqual(logic.policiesSnapshot(), []);
});
