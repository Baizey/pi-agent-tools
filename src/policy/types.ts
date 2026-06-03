export enum PolicyStatus {
  ALLOWED = "ALLOWED",
  DENIED = "DENIED",
}

export enum PolicyLifetime {
  ONCE = "ONCE",
  SESSION = "SESSION",
  FOREVER = "FOREVER",
}

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
  allowed: boolean;
  denied: boolean;
};

export type ShellPolicyResult = {
  command: string;
  segmentResults: ShellSegmentPolicyResult[];
  allowed: boolean;
  denied: boolean;
};

export type ShellPolicyScopeOption = {
  label: string;
  commandArgs: string[];
  flags: string[];
};

export type CodeExecMode = "inline" | "file";
export type CodeExecPolicyLanguage = string | "*";
export type CodeExecPolicyMode = CodeExecMode | "*";

export type CodeExecPolicy = {
  language: CodeExecPolicyLanguage;
  mode: CodeExecPolicyMode;
  lifetime: PolicyLifetime;
  status: PolicyStatus;
  reason: string;
};

export type CodeExecPolicyDeleteRequest = {
  language: CodeExecPolicyLanguage;
  mode: CodeExecPolicyMode;
};

export type CodeExecPolicySnapshot = {
  policies: CodeExecPolicy[];
};

export type CodeExecPolicyResult = {
  language: string;
  mode: CodeExecMode;
  matchedLanguage: CodeExecPolicyLanguage;
  matchedMode: CodeExecPolicyMode;
  matchedScope: string;
  matchedLifetime: PolicyLifetime;
  matchedStatus: PolicyStatus;
  matchedReason: string;
};

export type CodeExecPolicyScopeOption = {
  label: string;
  language: CodeExecPolicyLanguage;
  mode: CodeExecPolicyMode;
};

export type CodeExecEffectsReport = {
  summary: string;
  confidence: "low" | "medium" | "high";
  paths: Array<{
    path: string;
    accessTypes: FsAccessType[];
    reason: string;
    confidence: "low" | "medium" | "high";
  }>;
  processEffects: string[];
  networkEffects: string[];
  environmentEffects: string[];
  unknowns: string[];
};

export const isPersistedLifetime = (lifetime: PolicyLifetime): boolean =>
  lifetime === PolicyLifetime.FOREVER;

export const isModifyingAccess = (accessType: FsAccessType): boolean =>
  accessType !== FsAccessType.READ;
