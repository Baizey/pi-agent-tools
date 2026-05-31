"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PiPathPolicy = void 0;
const node_path_1 = __importDefault(require("node:path"));
const PathPolicyLogic_1 = require("./PathPolicyLogic");
const types_1 = require("./types");
class PiPathPolicy {
    static create(options) {
        var _a;
        const cwd = node_path_1.default.resolve(options.cwd);
        const standardizePath = (input) => node_path_1.default.resolve(cwd, input).normalize().replace(/[\\/]+$/g, "");
        const projectPiDir = (_a = options.projectPiDir) !== null && _a !== void 0 ? _a : node_path_1.default.join(cwd, ".pi");
        const policy = new PathPolicyLogic_1.PathPolicyLogic({ standardizePath });
        policy.addPolicies([
            PathPolicyLogic_1.PathPolicyLogic.createPolicy(cwd, types_1.PolicyStatus.ALLOWED, types_1.PolicyLifetime.SESSION, "Project path is allowed."),
            PathPolicyLogic_1.PathPolicyLogic.createPolicy(projectPiDir, types_1.PolicyStatus.DENIED, types_1.PolicyLifetime.SESSION, "Project pi internals are disallowed."),
        ]);
        if (options.globalPiDir) {
            policy.addPolicies([
                PathPolicyLogic_1.PathPolicyLogic.createPolicy(options.globalPiDir, types_1.PolicyStatus.DENIED, types_1.PolicyLifetime.SESSION, "Global pi internals are disallowed."),
            ]);
        }
        return policy;
    }
    static accessTypeForTool(toolName) {
        switch (toolName) {
            case "read":
            case "grep":
            case "find":
            case "ls":
                return types_1.FsAccessType.READ;
            case "write":
                return types_1.FsAccessType.WRITE;
            case "edit":
                return types_1.FsAccessType.EDIT;
            default:
                return null;
        }
    }
}
exports.PiPathPolicy = PiPathPolicy;
