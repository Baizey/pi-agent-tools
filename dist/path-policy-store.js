"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathPolicyStore = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
class PathPolicyStore {
    constructor(file) {
        this.file = file;
    }
    loadInto(policy) {
        if (!node_fs_1.default.existsSync(this.file))
            return;
        const snapshot = JSON.parse(node_fs_1.default.readFileSync(this.file, "utf8"));
        policy.addPolicies(snapshot.policies);
    }
    save(policy) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.file), { recursive: true });
        const snapshot = {
            policies: policy.persistedPolicies().sort((left, right) => left.path.localeCompare(right.path)),
        };
        node_fs_1.default.writeFileSync(this.file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    }
}
exports.PathPolicyStore = PathPolicyStore;
