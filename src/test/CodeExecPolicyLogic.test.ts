import assert from "node:assert/strict";
import {CodeExecPolicyLogic} from "../policy/code-exec/CodeExecPolicyLogic";
import {CodeExecMode, PolicyLifetime, PolicyStatus, PolicyWildcard} from "../policy/types";

function assertAllowed(result: ReturnType<CodeExecPolicyLogic["evaluate"]>) {
  assert.equal(result?.matchedStatus, PolicyStatus.ALLOWED);
}

function assertDenied(result: ReturnType<CodeExecPolicyLogic["evaluate"]>) {
  assert.equal(result?.matchedStatus, PolicyStatus.DENIED);
}

test("unknown code execution returns null when not denying by default", () => {
  const policy = new CodeExecPolicyLogic();
  assert.equal(policy.evaluate("python", CodeExecMode.INLINE, false), null);
});

test("deny by default returns a denied result", () => {
  const policy = new CodeExecPolicyLogic();
  assertDenied(policy.evaluate("python", CodeExecMode.INLINE, true));
});

test("exact language and mode policy applies", () => {
  const policy = new CodeExecPolicyLogic({
    policies: [CodeExecPolicyLogic.createPolicy("python", CodeExecMode.INLINE, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "test")],
  });
  assertAllowed(policy.evaluate("python", CodeExecMode.INLINE));
  assert.equal(policy.evaluate("python", CodeExecMode.FILE), null);
});

test("wildcard policies allow full deny code execution", () => {
  const policy = new CodeExecPolicyLogic({
    policies: [CodeExecPolicyLogic.createPolicy(PolicyWildcard.ALL, PolicyWildcard.ALL, PolicyStatus.DENIED, PolicyLifetime.SESSION, "no code")],
  });
  assertDenied(policy.evaluate("python", CodeExecMode.INLINE));
  assertDenied(policy.evaluate("javascript", CodeExecMode.FILE));
});

test("more specific policy beats wildcard policy", () => {
  const policy = new CodeExecPolicyLogic({
    policies: [
      CodeExecPolicyLogic.createPolicy(PolicyWildcard.ALL, CodeExecMode.INLINE, PolicyStatus.DENIED, PolicyLifetime.SESSION, "no inline"),
      CodeExecPolicyLogic.createPolicy("python", CodeExecMode.INLINE, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "python inline ok"),
    ],
  });
  assertAllowed(policy.evaluate("python", CodeExecMode.INLINE));
  assertDenied(policy.evaluate("ruby", CodeExecMode.INLINE));
});

test("pending scope options are language/mode hierarchy", () => {
  const policy = new CodeExecPolicyLogic();
  assert.deepEqual(policy.pendingPolicyScopeOptions("Python", CodeExecMode.INLINE).map((it) => it.label), [
    "python inline",
    "python *",
    "* inline",
    "* *",
  ]);
});

test("persisted policies keep forever policies only", () => {
  const policy = new CodeExecPolicyLogic({
    policies: [
      CodeExecPolicyLogic.createPolicy("python", CodeExecMode.INLINE, PolicyStatus.ALLOWED, PolicyLifetime.FOREVER, "persist"),
      CodeExecPolicyLogic.createPolicy("ruby", CodeExecMode.FILE, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "session"),
    ],
  });
  assert.deepEqual(policy.persistedPolicies().map((it) => `${it.language} ${it.mode}`), ["python inline"]);
});
