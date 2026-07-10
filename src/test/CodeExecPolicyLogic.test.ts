import assert from "node:assert/strict";
import {CodeExecPolicyLogic} from "../policy/code-exec/CodeExecPolicyLogic";
import {PolicyLifetime, PolicyStatus} from "../policy/types";

function assertAllowed(result: ReturnType<CodeExecPolicyLogic["evaluate"]>) {
  assert.equal(result?.matchedStatus, PolicyStatus.ALLOWED);
}

function assertDenied(result: ReturnType<CodeExecPolicyLogic["evaluate"]>) {
  assert.equal(result?.matchedStatus, PolicyStatus.DENIED);
}

test("unknown code execution returns null when not denying by default", () => {
  const policy = new CodeExecPolicyLogic();
  assert.equal(policy.evaluate("python", "inline", false), null);
});

test("deny by default returns a denied result", () => {
  const policy = new CodeExecPolicyLogic();
  assertDenied(policy.evaluate("python", "inline", true));
});

test("exact language and mode policy applies", () => {
  const policy = new CodeExecPolicyLogic({
    policies: [CodeExecPolicyLogic.createPolicy("python", "inline", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "test")],
  });
  assertAllowed(policy.evaluate("python", "inline"));
  assert.equal(policy.evaluate("python", "file"), null);
});

test("wildcard policies allow full deny code execution", () => {
  const policy = new CodeExecPolicyLogic({
    policies: [CodeExecPolicyLogic.createPolicy("*", "*", PolicyStatus.DENIED, PolicyLifetime.SESSION, "no code")],
  });
  assertDenied(policy.evaluate("python", "inline"));
  assertDenied(policy.evaluate("javascript", "file"));
});

test("more specific policy beats wildcard policy", () => {
  const policy = new CodeExecPolicyLogic({
    policies: [
      CodeExecPolicyLogic.createPolicy("*", "inline", PolicyStatus.DENIED, PolicyLifetime.SESSION, "no inline"),
      CodeExecPolicyLogic.createPolicy("python", "inline", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "python inline ok"),
    ],
  });
  assertAllowed(policy.evaluate("python", "inline"));
  assertDenied(policy.evaluate("ruby", "inline"));
});

test("pending scope options are language/mode hierarchy", () => {
  const policy = new CodeExecPolicyLogic();
  assert.deepEqual(policy.pendingPolicyScopeOptions("Python", "inline").map((it) => it.label), [
    "python inline",
    "python *",
    "* inline",
    "* *",
  ]);
});

test("persisted policies keep forever policies only", () => {
  const policy = new CodeExecPolicyLogic({
    policies: [
      CodeExecPolicyLogic.createPolicy("python", "inline", PolicyStatus.ALLOWED, PolicyLifetime.FOREVER, "persist"),
      CodeExecPolicyLogic.createPolicy("ruby", "file", PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "session"),
    ],
  });
  assert.deepEqual(policy.persistedPolicies().map((it) => `${it.language} ${it.mode}`), ["python inline"]);
});
