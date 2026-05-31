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

export const isPersistedLifetime = (lifetime: PolicyLifetime): boolean =>
  lifetime === PolicyLifetime.FOREVER;

export const isModifyingAccess = (accessType: FsAccessType): boolean =>
  accessType !== FsAccessType.READ;
