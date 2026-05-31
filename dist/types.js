"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isModifyingAccess = exports.isPersistedLifetime = exports.FsAccessType = exports.PolicyLifetime = exports.PolicyStatus = void 0;
var PolicyStatus;
(function (PolicyStatus) {
    PolicyStatus["ALLOWED"] = "ALLOWED";
    PolicyStatus["DENIED"] = "DENIED";
})(PolicyStatus || (exports.PolicyStatus = PolicyStatus = {}));
var PolicyLifetime;
(function (PolicyLifetime) {
    PolicyLifetime["ONCE"] = "ONCE";
    PolicyLifetime["SESSION"] = "SESSION";
    PolicyLifetime["FOREVER"] = "FOREVER";
})(PolicyLifetime || (exports.PolicyLifetime = PolicyLifetime = {}));
var FsAccessType;
(function (FsAccessType) {
    FsAccessType["DELETE"] = "DELETE";
    FsAccessType["WRITE"] = "WRITE";
    FsAccessType["EDIT"] = "EDIT";
    FsAccessType["EXECUTE"] = "EXECUTE";
    FsAccessType["READ"] = "READ";
})(FsAccessType || (exports.FsAccessType = FsAccessType = {}));
const isPersistedLifetime = (lifetime) => lifetime === PolicyLifetime.FOREVER;
exports.isPersistedLifetime = isPersistedLifetime;
const isModifyingAccess = (accessType) => accessType !== FsAccessType.READ;
exports.isModifyingAccess = isModifyingAccess;
