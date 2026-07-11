import {
  CodeExecMode,
  CodeExecPolicy,
  FsAccessType,
  PathPolicy,
  PathPolicyStatus,
  PolicyLifetime,
  PolicyStatus,
  PolicyWildcard,
  ShellFlagPolicyStatus,
  ShellPolicy,
  WebAccessType,
  WebPolicy,
} from "./types";

export function parseJsonObjectFile<T>(read: () => string): T | null {
  try {
    const parsed = JSON.parse(read()) as unknown;
    return isRecord(parsed) ? parsed as T : null;
  } catch {
    return null;
  }
}

export function sanitizePathPolicySnapshot(value: unknown): {policies: PathPolicy[]} {
  const record = isRecord(value) ? value : {};
  const policies = Array.isArray(record.policies)
    ? record.policies.map(sanitizePathPolicy).filter((it): it is PathPolicy => it !== null)
    : [];
  return {policies};
}

export function sanitizeShellPolicySnapshot(value: unknown): {policies: ShellPolicy[]} {
  const record = isRecord(value) ? value : {};
  const policies = Array.isArray(record.policies)
    ? record.policies.map(sanitizeShellPolicy).filter((it): it is ShellPolicy => it !== null)
    : [];
  return {policies};
}

export function sanitizeCodeExecPolicySnapshot(value: unknown): {policies: CodeExecPolicy[]} {
  const record = isRecord(value) ? value : {};
  const policies = Array.isArray(record.policies)
    ? record.policies.map(sanitizeCodeExecPolicy).filter((it): it is CodeExecPolicy => it !== null)
    : [];
  return {policies};
}

export function sanitizeWebPolicySnapshot(value: unknown): {policies: WebPolicy[]} {
  const record = isRecord(value) ? value : {};
  const policies = Array.isArray(record.policies)
    ? record.policies.map(sanitizeWebPolicy).filter((it): it is WebPolicy => it !== null)
    : [];
  return {policies};
}

function sanitizePathPolicy(value: unknown): PathPolicy | null {
  if (!isRecord(value) || !isNonEmptyString(value.path) || !isRecord(value.info)) return null;
  const info: PathPolicy["info"] = {};

  for (const accessType of Object.values(FsAccessType)) {
    const status = sanitizePathPolicyStatus(value.info[accessType], accessType);
    if (status) info[accessType] = status;
  }

  return Object.keys(info).length > 0 ? {path: value.path, info} : null;
}

function sanitizePathPolicyStatus(value: unknown, expectedAccessType: FsAccessType): PathPolicyStatus | null {
  if (!isRecord(value)) return null;
  if (value.accessType !== expectedAccessType) return null;
  if (!isPolicyStatus(value.status) || !isPolicyLifetime(value.lifetime) || typeof value.reason !== "string") return null;
  return {accessType: expectedAccessType, status: value.status, lifetime: value.lifetime, reason: value.reason};
}

function sanitizeShellPolicy(value: unknown): ShellPolicy | null {
  if (!isRecord(value)) return null;
  const commandArgs = Array.isArray(value.commandArgs)
    ? value.commandArgs.filter(isNonEmptyString)
    : [];
  if (commandArgs.length === 0) return null;
  if (!isPolicyStatus(value.status) || !isPolicyLifetime(value.lifetime) || typeof value.reason !== "string") return null;

  const rawFlags = isRecord(value.flags) ? Object.values(value.flags) : [];
  const flags = Object.fromEntries(
    rawFlags.map(sanitizeShellFlagPolicyStatus).filter((it): it is ShellFlagPolicyStatus => it !== null).map((it) => [it.flag, it]),
  );

  return {commandArgs, flags, allowAllFlags: value.allowAllFlags === true, status: value.status, lifetime: value.lifetime, reason: value.reason};
}

function sanitizeShellFlagPolicyStatus(value: unknown): ShellFlagPolicyStatus | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.flag) || !isPolicyStatus(value.status) || !isPolicyLifetime(value.lifetime) || typeof value.reason !== "string") return null;
  return {flag: value.flag, status: value.status, lifetime: value.lifetime, reason: value.reason};
}

function sanitizeCodeExecPolicy(value: unknown): CodeExecPolicy | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.language) || !isCodeExecMode(value.mode)) return null;
  if (!isPolicyStatus(value.status) || !isPolicyLifetime(value.lifetime) || typeof value.reason !== "string") return null;
  return {language: value.language, mode: value.mode, status: value.status, lifetime: value.lifetime, reason: value.reason};
}

function sanitizeWebPolicy(value: unknown): WebPolicy | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.host) || !isNonEmptyString(value.path) || !isWebAccessType(value.accessType)) return null;
  if (!isPolicyStatus(value.status) || !isPolicyLifetime(value.lifetime) || typeof value.reason !== "string") return null;
  return {host: value.host, path: value.path, accessType: value.accessType, status: value.status, lifetime: value.lifetime, reason: value.reason};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPolicyStatus(value: unknown): value is PolicyStatus {
  return typeof value === "string" && Object.values(PolicyStatus).some((status) => status === value);
}

function isPolicyLifetime(value: unknown): value is PolicyLifetime {
  return typeof value === "string" && Object.values(PolicyLifetime).some((lifetime) => lifetime === value);
}

function isCodeExecMode(value: unknown): value is CodeExecMode | PolicyWildcard.ALL {
  return value === PolicyWildcard.ALL
    || (typeof value === "string" && Object.values(CodeExecMode).some((mode) => mode === value));
}

function isWebAccessType(value: unknown): value is WebAccessType {
  return typeof value === "string" && Object.values(WebAccessType).some((accessType) => accessType === value);
}
