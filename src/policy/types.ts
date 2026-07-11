export enum PolicyStatus {
  ALLOWED = "ALLOWED",
  DENIED = "DENIED",
}

export enum PolicyLifetime {
  ONCE = "ONCE",
  SESSION = "SESSION",
  FOREVER = "FOREVER",
}

export enum PolicyWildcard {
  ALL = "*",
}

export enum PolicyResolutionSource {
  SYSTEM = "SYSTEM",
  EXISTING_USER_POLICY = "EXISTING_USER_POLICY",
  NEW_USER_DECISION = "NEW_USER_DECISION",
}

export const policyResolutionSourceText = (source: PolicyResolutionSource): string => {
  switch (source) {
    case PolicyResolutionSource.SYSTEM:
      return "Resolved automatically by policy logic without using a stored user policy or asking the user now.";
    case PolicyResolutionSource.EXISTING_USER_POLICY:
      return "Resolved by an existing user policy from an earlier decision.";
    case PolicyResolutionSource.NEW_USER_DECISION:
      return "Resolved by a user decision provided just now for this request.";
  }
};

export enum FsAccessType {
  DELETE = "DELETE",
  WRITE = "WRITE",
  EDIT = "EDIT",
  EXECUTE = "EXECUTE",
  READ = "READ",
}

export type PathPolicyStatus = {
  accessType: FsAccessType;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export type PathPolicy = {
  path: string;
  info: Partial<Record<FsAccessType, PathPolicyStatus>>;
};

export type PathPolicyDeleteRequest = {
  path: string;
  accessTypes: FsAccessType[];
};

export type PathPolicySnapshot = {
  policies: PathPolicy[];
};

export type PathPolicyResult = {
  evaluatedPath: string;
  evaluatedAccessType: FsAccessType;
  matchedPattern: string;
  matchedLifetime: PolicyLifetime;
  matchedStatus: PolicyStatus;
  matchedReason: string;
  resolutionSource: PolicyResolutionSource;
};

export type ShellFlagPolicyStatus = {
  flag: string;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export type ShellPolicy = {
  commandArgs: string[];
  flags: Record<string, ShellFlagPolicyStatus>;
  allowAllFlags: boolean;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export type ShellPolicyDeleteRequest = {
  commandArgs: string[];
  removeEntirePolicy: boolean;
  flags: string[];
};

export type ShellPolicySnapshot = {
  policies: ShellPolicy[];
};

export type ShellSegmentPolicyResult = {
  rawSegment: string;
  commandPrefix: string[];
  flags: ShellFlagPolicyStatus[];
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
  resolutionSource: PolicyResolutionSource;
  allowed: boolean;
  denied: boolean;
};

export type ShellPolicyResult = {
  command: string;
  segmentResults: ShellSegmentPolicyResult[];
  resolutionSource: PolicyResolutionSource;
  allowed: boolean;
  denied: boolean;
};

export type ShellPolicyScopeOption = {
  label: string;
  commandArgs: string[];
  flags: string[];
  allowAllFlags?: boolean;
};

export enum CodeExecMode {
  INLINE = "inline",
  FILE = "file",
}
export type CodeExecPolicyMode = CodeExecMode | PolicyWildcard.ALL;

export type CodeExecPolicy = {
  language: string;
  mode: CodeExecPolicyMode;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export type CodeExecPolicyDeleteRequest = {
  language: string;
  mode: CodeExecPolicyMode;
};

export type CodeExecPolicySnapshot = {
  policies: CodeExecPolicy[];
};

export type CodeExecPolicyResult = {
  language: string;
  mode: CodeExecMode;
  matchedLanguage: string;
  matchedMode: CodeExecPolicyMode;
  matchedScope: string;
  matchedLifetime: PolicyLifetime;
  matchedStatus: PolicyStatus;
  matchedReason: string;
  resolutionSource: PolicyResolutionSource;
};

export type CodeExecPolicyScopeOption = {
  label: string;
  language: string;
  mode: CodeExecPolicyMode;
};

export enum WebAccessType {
  READ = "READ",
  SEARCH = "SEARCH",
}

export type WebPolicy = {
  host: string;
  path: string;
  accessType: WebAccessType;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export type WebPolicyDeleteRequest = {
  host: string;
  path: string;
  accessType: WebAccessType;
};

export type WebPolicySnapshot = {
  policies: WebPolicy[];
};

export type WebPolicyResult = {
  url: string;
  accessType: WebAccessType;
  host: string;
  path: string;
  matchedHost: string;
  matchedPath: string;
  matchedScope: string;
  matchedLifetime: PolicyLifetime;
  matchedStatus: PolicyStatus;
  matchedReason: string;
  resolutionSource: PolicyResolutionSource;
};

export type WebPolicyScopeOption = {
  label: string;
  host: string;
  path: string;
  accessType: WebAccessType;
};

export const isPersistedLifetime = (lifetime: PolicyLifetime): boolean =>
  lifetime === PolicyLifetime.FOREVER;

export const isModifyingAccess = (accessType: FsAccessType): boolean =>
  accessType !== FsAccessType.READ;
