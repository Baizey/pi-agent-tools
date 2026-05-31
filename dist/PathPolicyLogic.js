"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathPolicyLogic = void 0;
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("./types");
class PathPolicyLogic {
    static createPolicy(policyPath, status, lifetime, reason) {
        return {
            path: policyPath,
            info: {
                [types_1.FsAccessType.READ]: PathPolicyLogic.createStatus(types_1.FsAccessType.READ, lifetime, status, reason),
                [types_1.FsAccessType.WRITE]: PathPolicyLogic.createStatus(types_1.FsAccessType.WRITE, lifetime, status, reason),
                [types_1.FsAccessType.EXECUTE]: PathPolicyLogic.createStatus(types_1.FsAccessType.EXECUTE, lifetime, status, reason),
                [types_1.FsAccessType.DELETE]: PathPolicyLogic.createStatus(types_1.FsAccessType.DELETE, lifetime, status, reason),
                [types_1.FsAccessType.EDIT]: PathPolicyLogic.createStatus(types_1.FsAccessType.EDIT, lifetime, status, reason),
            },
        };
    }
    static createStatus(accessType, lifetime, status, reason) {
        return { accessType, lifetime, status, reason };
    }
    constructor(options = {}) {
        var _a;
        this.policies = [];
        this.standardizePath = (_a = options.standardizePath) !== null && _a !== void 0 ? _a : PathPolicyLogic.defaultStandardizePath;
        if (options.policies)
            this.addPolicies(options.policies);
    }
    evaluate(inputPath, accessType, denyByDefault = false) {
        const evaluatedPath = this.standardizePath(inputPath);
        const policy = this.findPolicy(evaluatedPath, accessType);
        if (!policy) {
            return {
                evaluatedPath,
                evaluatedAccessType: accessType,
                matchedPattern: "(none)",
                matchedLifetime: denyByDefault ? types_1.PolicyLifetime.FOREVER : types_1.PolicyLifetime.ONCE,
                matchedStatus: types_1.PolicyStatus.DENIED,
                matchedReason: denyByDefault
                    ? "No matching policy found. denied by default, you cannot access this"
                    : "No matching policy found. Ask for permission if you want to proceed.",
            };
        }
        const status = policy.info[accessType];
        return {
            evaluatedPath,
            evaluatedAccessType: accessType,
            matchedPattern: policy.path,
            matchedLifetime: status.lifetime,
            matchedStatus: status.status,
            matchedReason: status.reason,
        };
    }
    addPolicies(policies) {
        for (const rawPolicy of policies) {
            const policy = this.standardizePolicy(rawPolicy);
            const stored = this.policies.find((it) => it.path === policy.path);
            if (!stored) {
                this.policies.push(policy);
                continue;
            }
            for (const incoming of Object.values(policy.info)) {
                if (!incoming)
                    continue;
                stored.info[incoming.accessType] = Object.assign({}, incoming);
            }
        }
    }
    removePolicies(requests) {
        for (const rawRequest of requests) {
            const request = this.standardizeDeleteRequest(rawRequest);
            const stored = this.policies.find((it) => it.path === request.path);
            if (!stored)
                continue;
            for (const accessType of request.accessTypes)
                delete stored.info[accessType];
            if (Object.keys(stored.info).length === 0)
                this.policies.splice(this.policies.indexOf(stored), 1);
        }
    }
    persistedPolicies() {
        return this.policies
            .map((policy) => ({
            path: policy.path,
            info: Object.fromEntries(Object.entries(policy.info).filter(([, status]) => status && (0, types_1.isPersistedLifetime)(status.lifetime))),
        }))
            .filter((policy) => Object.keys(policy.info).length > 0);
    }
    toDenyReasonOrNull(result) {
        if (result.matchedStatus === types_1.PolicyStatus.ALLOWED)
            return null;
        return [
            "ACCESS DENIED",
            `Evaluated path: '${result.evaluatedPath}'`,
            `Evaluated access type: ${result.evaluatedAccessType}`,
            `Policy lifetime: ${result.matchedLifetime}`,
            `Policy path: '${result.matchedPattern}'`,
            `Policy reason: ${result.matchedReason}`,
        ].join("\n");
    }
    findPolicy(evaluatedPath, accessType) {
        return this.policies
            .filter((policy) => policy.info[accessType] && this.isSameOrChildPath(evaluatedPath, policy.path))
            .sort((left, right) => right.path.localeCompare(left.path))[0];
    }
    standardizePolicy(policy) {
        return {
            path: this.standardizePath(policy.path),
            info: Object.fromEntries(Object.entries(policy.info).map(([accessType, status]) => [accessType, status ? Object.assign({}, status) : status])),
        };
    }
    standardizeDeleteRequest(request) {
        return {
            path: this.standardizePath(request.path),
            accessTypes: [...request.accessTypes],
        };
    }
    isSameOrChildPath(candidate, parent) {
        const ignoreCase = PathPolicyLogic.looksLikeWindowsPath(candidate) || PathPolicyLogic.looksLikeWindowsPath(parent);
        const left = ignoreCase ? candidate.toLowerCase() : candidate;
        const right = ignoreCase ? parent.toLowerCase() : parent;
        if (left === right)
            return true;
        return left.length > right.length && left.startsWith(right) && ["\\", "/"].includes(candidate[parent.length]);
    }
    static defaultStandardizePath(input) {
        return node_path_1.default.resolve(input).normalize().replace(/[\\/]+$/g, "");
    }
    static looksLikeWindowsPath(value) {
        return value.length >= 2 && value[1] === ":";
    }
}
exports.PathPolicyLogic = PathPolicyLogic;
