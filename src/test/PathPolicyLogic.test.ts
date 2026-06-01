import assert from "node:assert/strict";
import path from "node:path";
import { tempDir, test } from "./TestHarness";
import {
  FsAccessType,
  PathPolicy,
  PathPolicyLogic,
  PathPolicyResult,
  PolicyLifetime,
  PolicyStatus,
} from "../index";

const testPolicy = () => {
  const base = path.join(tempDir("pidev-path-policy-"), ".gantry");
  const agent = path.join(base, "agent");
  const system = path.join(base, "system");
  const policy = new PathPolicyLogic({
    policies: [
      PathPolicyLogic.createPolicy(system, PolicyStatus.DENIED, PolicyLifetime.SESSION, "System path is disallowed."),
      PathPolicyLogic.createPolicy(agent, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "Agent path is allowed."),
    ],
  });

  return { base, agent, system, policy };
};

const assertAllowed = (result: PathPolicyResult | null): void => {
  assert.ok(result);
  assert.equal(result.matchedStatus, PolicyStatus.ALLOWED);
};

const assertDeniedOrUnknown = (result: PathPolicyResult | null): void => {
  assert.ok(result);
  assert.notEqual(result.matchedStatus, PolicyStatus.ALLOWED);
};

const looksLikeWindowsDrivePath = (value: string): boolean => value.length >= 2 && value[1] === ":";

test("baseline agent path is allowed", () => {
  const { agent, policy } = testPolicy();
  assertAllowed(policy.evaluate(path.join(agent, "payload.txt"), FsAccessType.READ, true));
});

test("baseline system path is denied", () => {
  const { system, policy } = testPolicy();
  assertDeniedOrUnknown(policy.evaluate(path.join(system, "payload.txt"), FsAccessType.READ, true));
});

test("agent path cannot be used to allow access to sibling with same prefix", () => {
  const { base, policy } = testPolicy();
  assertDeniedOrUnknown(policy.evaluate(path.join(base, "agent-secret", "payload.txt"), FsAccessType.READ, true));
});

test("system path cannot deny sibling with same prefix", () => {
  const { base, policy } = testPolicy();
  assertDeniedOrUnknown(policy.evaluate(path.join(base, "systematic", "payload.txt"), FsAccessType.READ, true));
});

test("parent traversal out of allowed agent path is denied when it resolves into system", () => {
  const { agent, policy } = testPolicy();
  assertDeniedOrUnknown(policy.evaluate(path.join(agent, "..", "system", "payload.txt"), FsAccessType.WRITE, true));
});

test("parent traversal within system path cannot escape denial by using nested dot segments", () => {
  const { system, policy } = testPolicy();
  assertDeniedOrUnknown(policy.evaluate(path.join(system, "nested", "..", "payload.txt"), FsAccessType.EDIT, true));
});

test("windows drive paths cannot bypass system denial by changing case", () => {
  const { system, policy } = testPolicy();
  if (!looksLikeWindowsDrivePath(system)) return;

  assertDeniedOrUnknown(policy.evaluate(path.join(system.toUpperCase(), "payload.txt"), FsAccessType.DELETE, true));
});

test("custom allowed path cannot allow sibling with same prefix", () => {
  const { base, policy } = testPolicy();
  const allowedPath = path.join(base, "allowed");

  policy.addPolicies([
    PathPolicyLogic.createPolicy(allowedPath, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "Test allowed path."),
  ]);

  assertDeniedOrUnknown(policy.evaluate(path.join(base, "allowed-but-not-really", "payload.txt"), FsAccessType.READ, true));
});

test("trailing separators are ignored when matching paths", () => {
  const { base, policy } = testPolicy();
  const allowedPath = path.join(base, "allowed-with-trailing-separator");

  policy.addPolicies([
    PathPolicyLogic.createPolicy(`${allowedPath}\\`, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "Test allowed path."),
  ]);

  assertAllowed(policy.evaluate(`${allowedPath}/`, FsAccessType.READ, true));
  assertAllowed(policy.evaluate(path.join(allowedPath, "payload.txt"), FsAccessType.READ, true));
});

test("more specific denied child beats broader allowed parent", () => {
  const { base, policy } = testPolicy();
  const parent = path.join(base, "workspace");
  const child = path.join(parent, "secrets");

  policy.addPolicies([
    PathPolicyLogic.createPolicy(parent, PolicyStatus.ALLOWED, PolicyLifetime.SESSION, "Test workspace is allowed."),
    PathPolicyLogic.createPolicy(child, PolicyStatus.DENIED, PolicyLifetime.SESSION, "Test secrets are denied."),
  ]);

  assertDeniedOrUnknown(policy.evaluate(path.join(child, "payload.txt"), FsAccessType.READ, true));
});

test("per-access deny beats same path allow for another access type", () => {
  const { base, policy } = testPolicy();
  const target = path.join(base, "mixed-access");
  const pathPolicy: PathPolicy = {
    path: target,
    info: {
      [FsAccessType.READ]: PathPolicyLogic.createStatus(
        FsAccessType.READ,
        PolicyLifetime.SESSION,
        PolicyStatus.ALLOWED,
        "Read is allowed.",
      ),
      [FsAccessType.WRITE]: PathPolicyLogic.createStatus(
        FsAccessType.WRITE,
        PolicyLifetime.SESSION,
        PolicyStatus.DENIED,
        "Write is denied.",
      ),
    },
  };

  policy.addPolicies([pathPolicy]);

  assertAllowed(policy.evaluate(path.join(target, "payload.txt"), FsAccessType.READ, true));
  assertDeniedOrUnknown(policy.evaluate(path.join(target, "payload.txt"), FsAccessType.WRITE, true));
});

test("relative path cannot escape unknown status by resolving through allowed agent prefix text", () => {
  const { agent, policy } = testPolicy();
  assertDeniedOrUnknown(policy.evaluate(path.join(agent, "..", "agent-shadow", "payload.txt"), FsAccessType.READ, true));
});

test.skip("symlink inside allowed agent path cannot grant access to denied system path");
test.skip("hard link inside allowed agent path cannot grant access to denied system file");
