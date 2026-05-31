"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSameOrChildPath = exports.resolveFromCwd = exports.nodeResolvePath = void 0;
const node_path_1 = __importDefault(require("node:path"));
const nodeResolvePath = (input) => stripTrailingSeparators(node_path_1.default.resolve(input).normalize());
exports.nodeResolvePath = nodeResolvePath;
const resolveFromCwd = (cwd) => {
    const absoluteCwd = (0, exports.nodeResolvePath)(cwd);
    return (input) => stripTrailingSeparators(node_path_1.default.resolve(absoluteCwd, input).normalize());
};
exports.resolveFromCwd = resolveFromCwd;
const isSameOrChildPath = (candidate, parent) => {
    const ignoreCase = looksLikeWindowsPath(candidate) || looksLikeWindowsPath(parent);
    if (equals(candidate, parent, ignoreCase))
        return true;
    return candidate.length > parent.length &&
        startsWith(candidate, parent, ignoreCase) &&
        isPathSeparator(candidate[parent.length]);
};
exports.isSameOrChildPath = isSameOrChildPath;
const stripTrailingSeparators = (value) => value.replace(/[\\/]+$/g, "");
const isPathSeparator = (char) => char === "\\" || char === "/";
const looksLikeWindowsPath = (value) => value.length >= 2 && value[1] === ":";
const equals = (left, right, ignoreCase) => ignoreCase ? left.toLowerCase() === right.toLowerCase() : left === right;
const startsWith = (value, prefix, ignoreCase) => ignoreCase ? value.toLowerCase().startsWith(prefix.toLowerCase()) : value.startsWith(prefix);
