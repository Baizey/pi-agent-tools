"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const index_1 = require("./index");
const test = (name, fn) => {
    try {
        fn();
        console.log(`✓ ${name}`);
    }
    catch (error) {
        console.error(`✗ ${name}`);
        throw error;
    }
};
const tempDir = () => node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "pidev-path-policy-"));
const testPolicy = () => {
    const base = node_path_1.default.join(tempDir(), ".gantry");
    const agent = node_path_1.default.join(base, "agent");
    const system = node_path_1.default.join(base, "system");
    const policy = new index_1.PathPolicyLogic({
        policies: [
            index_1.PathPolicyLogic.createPolicy(system, index_1.PolicyStatus.DENIED, index_1.PolicyLifetime.SESSION, "System path is disallowed."),
            index_1.PathPolicyLogic.createPolicy(agent, index_1.PolicyStatus.ALLOWED, index_1.PolicyLifetime.SESSION, "Agent path is allowed."),
        ],
    });
    return { base, agent, system, policy };
};
const assertAllowed = (result) => {
    strict_1.default.equal(result.matchedStatus, index_1.PolicyStatus.ALLOWED);
};
const assertDeniedOrUnknown = (result) => {
    strict_1.default.notEqual(result.matchedStatus, index_1.PolicyStatus.ALLOWED);
};
test("baseline agent path is allowed", () => {
    const { agent, policy } = testPolicy();
    assertAllowed(policy.evaluate(node_path_1.default.join(agent, "payload.txt"), index_1.FsAccessType.READ, true));
});
test("baseline system path is denied", () => {
    const { system, policy } = testPolicy();
    assertDeniedOrUnknown(policy.evaluate(node_path_1.default.join(system, "payload.txt"), index_1.FsAccessType.READ, true));
});
test("agent path cannot allow sibling with same prefix", () => {
    const { base, policy } = testPolicy();
    assertDeniedOrUnknown(policy.evaluate(node_path_1.default.join(base, "agent-secret", "payload.txt"), index_1.FsAccessType.READ, true));
});
test("system path cannot deny sibling with same prefix", () => {
    const { base, policy } = testPolicy();
    assertDeniedOrUnknown(policy.evaluate(node_path_1.default.join(base, "systematic", "payload.txt"), index_1.FsAccessType.READ, true));
});
test("parent traversal out of allowed path is standardized before evaluation", () => {
    const { agent, policy } = testPolicy();
    assertDeniedOrUnknown(policy.evaluate(node_path_1.default.join(agent, "..", "system", "payload.txt"), index_1.FsAccessType.WRITE, true));
});
test("custom allowed path cannot allow sibling with same prefix", () => {
    const { base, policy } = testPolicy();
    const allowedPath = node_path_1.default.join(base, "allowed");
    policy.addPolicies([
        index_1.PathPolicyLogic.createPolicy(allowedPath, index_1.PolicyStatus.ALLOWED, index_1.PolicyLifetime.SESSION, "Test allowed path."),
    ]);
    assertDeniedOrUnknown(policy.evaluate(node_path_1.default.join(base, "allowed-but-not-really", "payload.txt"), index_1.FsAccessType.READ, true));
});
test("trailing separators are ignored", () => {
    const { base, policy } = testPolicy();
    const allowedPath = node_path_1.default.join(base, "allowed-with-trailing-separator");
    policy.addPolicies([
        index_1.PathPolicyLogic.createPolicy(`${allowedPath}\\`, index_1.PolicyStatus.ALLOWED, index_1.PolicyLifetime.SESSION, "Test allowed path."),
    ]);
    assertAllowed(policy.evaluate(`${allowedPath}/`, index_1.FsAccessType.READ, true));
    assertAllowed(policy.evaluate(node_path_1.default.join(allowedPath, "payload.txt"), index_1.FsAccessType.READ, true));
});
test("more specific denied child beats broader allowed parent", () => {
    const { base, policy } = testPolicy();
    const parent = node_path_1.default.join(base, "workspace");
    const child = node_path_1.default.join(parent, "secrets");
    policy.addPolicies([
        index_1.PathPolicyLogic.createPolicy(parent, index_1.PolicyStatus.ALLOWED, index_1.PolicyLifetime.SESSION, "Test workspace is allowed."),
        index_1.PathPolicyLogic.createPolicy(child, index_1.PolicyStatus.DENIED, index_1.PolicyLifetime.SESSION, "Test secrets are denied."),
    ]);
    assertDeniedOrUnknown(policy.evaluate(node_path_1.default.join(child, "payload.txt"), index_1.FsAccessType.READ, true));
});
test("per-access deny beats same path allow for another access type", () => {
    const { base, policy } = testPolicy();
    const target = node_path_1.default.join(base, "mixed-access");
    const pathPolicy = {
        path: target,
        info: {
            [index_1.FsAccessType.READ]: index_1.PathPolicyLogic.createStatus(index_1.FsAccessType.READ, index_1.PolicyLifetime.SESSION, index_1.PolicyStatus.ALLOWED, "Read is allowed."),
            [index_1.FsAccessType.WRITE]: index_1.PathPolicyLogic.createStatus(index_1.FsAccessType.WRITE, index_1.PolicyLifetime.SESSION, index_1.PolicyStatus.DENIED, "Write is denied."),
        },
    };
    policy.addPolicies([pathPolicy]);
    assertAllowed(policy.evaluate(node_path_1.default.join(target, "payload.txt"), index_1.FsAccessType.READ, true));
    assertDeniedOrUnknown(policy.evaluate(node_path_1.default.join(target, "payload.txt"), index_1.FsAccessType.WRITE, true));
});
