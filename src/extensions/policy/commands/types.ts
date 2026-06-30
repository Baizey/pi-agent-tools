import {FsAccessType, PolicyLifetime, PolicyStatus, WebAccessType} from "../../../policy/types";

export enum PolicyCommandName {
  POLICY = "policy",
  IO = "policy-io",
  SHELL = "policy-shell",
  CODE = "policy-code",
  WEB = "policy-web",
}

export enum PolicyCommandAction {
  SHOW = "show",
  EVAL = "eval",
  ALLOW = "allow",
  DENY = "deny",
  REMOVE = "remove",
  CLEAR = "clear",
}

export enum PolicyCommandKind {
  ALL = "all",
  IO = "io",
  SHELL = "shell",
  CODE = "code",
  WEB = "web",
}

export enum PolicyCommandOption {
  LIFETIME = "--lifetime",
  REASON = "--reason",
  YES = "--yes",
  FLAG = "--flag",
  ALL_FLAGS = "--all-flags",
  ENTIRE = "--entire",
}

export enum PolicyCommandLifetimeArg {
  SESSION = "session",
  FOREVER = "forever",
}

export enum PolicyCommandCodeMode {
  INLINE = "inline",
  FILE = "file",
}

export enum PolicyCommandWildcard {
  ALL = "*",
}

export enum PolicyCommandMessageKind {
  INFO = "info",
  ERROR = "error",
}

export type PolicyCommandResult = {
  message: string;
  kind: PolicyCommandMessageKind;
};

export type CommonPolicyCommandOptions = {
  lifetime: PolicyLifetime;
  lifetimeSpecified: boolean;
  reason?: string;
  reasonSpecified: boolean;
  yes: boolean;
  flags: string[];
  allFlags: boolean;
  entire: boolean;
  operands: string[];
  error?: string;
};

export const policyCommandActions = Object.values(PolicyCommandAction);
export const policyCommandKinds = Object.values(PolicyCommandKind);
export const policyCommandLifetimeArgs = Object.values(PolicyCommandLifetimeArg);
export const policyCommandAccessTypes = Object.values(FsAccessType);
export const policyCommandWebAccessTypes = Object.values(WebAccessType);

export const defaultPolicyCommandLifetime = PolicyLifetime.SESSION;

export function policyStatusForAction(action: PolicyCommandAction): PolicyStatus | null {
  switch (action) {
    case PolicyCommandAction.ALLOW:
      return PolicyStatus.ALLOWED;
    case PolicyCommandAction.DENY:
      return PolicyStatus.DENIED;
    default:
      return null;
  }
}

export function policyLifetimeForArg(value: string | undefined): PolicyLifetime | null {
  switch (value) {
    case undefined:
      return defaultPolicyCommandLifetime;
    case PolicyCommandLifetimeArg.SESSION:
      return PolicyLifetime.SESSION;
    case PolicyCommandLifetimeArg.FOREVER:
      return PolicyLifetime.FOREVER;
    default:
      return null;
  }
}

export function policyLifetimeArgForLifetime(value: PolicyLifetime): PolicyCommandLifetimeArg | null {
  switch (value) {
    case PolicyLifetime.SESSION:
      return PolicyCommandLifetimeArg.SESSION;
    case PolicyLifetime.FOREVER:
      return PolicyCommandLifetimeArg.FOREVER;
    default:
      return null;
  }
}
