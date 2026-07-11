import {AutocompleteItem} from "../../../pi/types";
import {AgentRuntime} from "../../../pi/runtime";
import {
  CodeExecMode,
  CodeExecPolicyDeleteRequest,
  FsAccessType,
  PathPolicyDeleteRequest,
  PolicyLifetime,
  ShellPolicyDeleteRequest,
  WebAccessType,
  WebPolicyDeleteRequest,
} from "../../../policy/types";
import {
  CommonPolicyCommandOptions,
  defaultPolicyCommandLifetime,
  PolicyCommandAction,
  PolicyCommandKind,
  PolicyCommandLifetimeArg,
  PolicyCommandMessageKind,
  PolicyCommandOption,
  PolicyCommandResult,
  PolicyWildcard,
  policyLifetimeForArg,
} from "./types";

export enum PolicyCommandText {
  MISSING_ACTION = "Missing action.",
  MISSING_PATH = "Missing path.",
  MISSING_URL = "Missing URL.",
  MISSING_COMMAND = "Missing command.",
  MISSING_LANGUAGE = "Missing language.",
  MISSING_MODE = "Missing code execution mode.",
  CLEAR_REQUIRES_YES = "Refusing to clear policies without --yes.",
}

export function ok(message: string): PolicyCommandResult {
  return {message, kind: PolicyCommandMessageKind.INFO};
}

export function err(message: string): PolicyCommandResult {
  return {message, kind: PolicyCommandMessageKind.ERROR};
}

export function firstAction(tokens: string[]): PolicyCommandAction | null {
  const action = tokens[0] as PolicyCommandAction | undefined;
  return action && Object.values(PolicyCommandAction).includes(action) ? action : null;
}

export function firstKind(tokens: string[]): PolicyCommandKind | null {
  const kind = tokens[0] as PolicyCommandKind | undefined;
  return kind && Object.values(PolicyCommandKind).includes(kind) ? kind : null;
}

export function parseCommonOptions(tokens: string[]): CommonPolicyCommandOptions {
  const operands: string[] = [];
  const flags: string[] = [];
  let lifetime = defaultPolicyCommandLifetime;
  let lifetimeSpecified = false;
  let reason: string | undefined;
  let reasonSpecified = false;
  let yes = false;
  let allFlags = false;
  let entire = false;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === PolicyCommandOption.YES) {
      yes = true;
      continue;
    }
    if (token === PolicyCommandOption.ALL_FLAGS) {
      allFlags = true;
      continue;
    }
    if (token === PolicyCommandOption.ENTIRE) {
      entire = true;
      continue;
    }
    if (token === PolicyCommandOption.LIFETIME) {
      const value = tokens[++index];
      if (!value) return {...emptyOptions(), error: "Missing value for --lifetime."};
      const parsed = policyLifetimeForArg(value);
      if (!parsed) return {...emptyOptions(), error: `Invalid lifetime: ${value}`};
      lifetime = parsed;
      lifetimeSpecified = true;
      continue;
    }
    if (token.startsWith(`${PolicyCommandOption.LIFETIME}=`)) {
      const value = token.slice(`${PolicyCommandOption.LIFETIME}=`.length);
      const parsed = policyLifetimeForArg(value);
      if (!parsed) return {...emptyOptions(), error: `Invalid lifetime: ${value}`};
      lifetime = parsed;
      lifetimeSpecified = true;
      continue;
    }
    if (token === PolicyCommandOption.REASON) {
      const value = tokens[++index];
      if (!value) return {...emptyOptions(), error: "Missing value for --reason."};
      reason = value;
      reasonSpecified = true;
      continue;
    }
    if (token.startsWith(`${PolicyCommandOption.REASON}=`)) {
      reason = token.slice(`${PolicyCommandOption.REASON}=`.length);
      reasonSpecified = true;
      continue;
    }
    if (token === PolicyCommandOption.FLAG) {
      const value = tokens[++index];
      if (!value) return {...emptyOptions(), error: "Missing value for --flag."};
      flags.push(value);
      continue;
    }
    if (token.startsWith(`${PolicyCommandOption.FLAG}=`)) {
      const value = token.slice(`${PolicyCommandOption.FLAG}=`.length);
      if (!value) return {...emptyOptions(), error: "Missing value for --flag."};
      flags.push(value);
      continue;
    }
    operands.push(token);
  }

  return {lifetime, lifetimeSpecified, reason, reasonSpecified, yes, flags, allFlags, entire, operands};
}

export function tokenizePolicyCommandArgs(args: string): string[] {
  const tokens: string[] = [];
  const input = args.trim();
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  let tokenStarted = false;

  const flush = (): void => {
    if (tokenStarted || current.length > 0) tokens.push(current);
    current = "";
    tokenStarted = false;
  };

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (escaped) {
      current += char;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      const next = input[index + 1];
      const escapesInQuote = quote !== null && (next === quote || next === "\\");
      const escapesBare = quote === null && (next === "\\" || next === "'" || next === "\"" || (next !== undefined && /\s/.test(next)));
      if (escapesInQuote || escapesBare) {
        escaped = true;
        tokenStarted = true;
        continue;
      }
      current += char;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      tokenStarted = true;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) flush();
    else {
      current += char;
      tokenStarted = true;
    }
  }
  flush();
  return tokens;
}

export function parseFsAccessTypes(
  tokens: string[],
  fallback = Object.values(FsAccessType),
): {accessTypes: FsAccessType[]; unknown: string[]} {
  const accessTypes: FsAccessType[] = [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const accessType = parseFsAccessType(token);
    if (!accessType) unknown.push(token);
    else if (!accessTypes.includes(accessType)) accessTypes.push(accessType);
  }
  return {accessTypes: accessTypes.length > 0 ? accessTypes : [...fallback], unknown};
}

export function parseWebAccessTypes(
  tokens: string[],
  fallback = Object.values(WebAccessType),
): {accessTypes: WebAccessType[]; unknown: string[]} {
  const accessTypes: WebAccessType[] = [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const accessType = parseWebAccessType(token);
    if (!accessType) unknown.push(token);
    else if (!accessTypes.includes(accessType)) accessTypes.push(accessType);
  }
  return {accessTypes: accessTypes.length > 0 ? accessTypes : [...fallback], unknown};
}

export function parseFsAccessType(token: string): FsAccessType | null {
  const value = token.toUpperCase() as FsAccessType;
  return Object.values(FsAccessType).includes(value) ? value : null;
}

export function parseWebAccessType(token: string): WebAccessType | null {
  const value = token.toUpperCase() as WebAccessType;
  return Object.values(WebAccessType).includes(value) ? value : null;
}

export function parseCodeMode(token: string | undefined): CodeExecMode | PolicyWildcard.ALL | null {
  if (token === PolicyWildcard.ALL) return PolicyWildcard.ALL;
  if (token === CodeExecMode.INLINE || token === CodeExecMode.FILE) return token;
  return null;
}

export function clearOptionsError(options: CommonPolicyCommandOptions, allowedOperandCount: number): string | null {
  if (options.operands.length > allowedOperandCount) return "Clear does not accept extra operands.";
  if (options.lifetimeSpecified) return "Clear does not accept --lifetime.";
  if (options.reasonSpecified) return "Clear does not accept --reason.";
  if (options.flags.length > 0 || options.allFlags || options.entire) return "Clear does not accept shell flag options.";
  return null;
}

export function defaultReason(commandName: string, action: PolicyCommandAction, target: string): string {
  return `User command /${commandName} ${action} ${target}.`;
}

export function saveRuntimeStores(runtime: AgentRuntime): void {
  runtime.pathPolicyStore.save(runtime.pathPolicy);
  runtime.shellPolicyStore.save(runtime.shellPolicy);
  runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
  runtime.webPolicyStore.save(runtime.webPolicy);
}

export function maybeSavePolicy(runtime: AgentRuntime, lifetime: PolicyLifetime, kind: PolicyCommandKind): void {
  if (lifetime !== PolicyLifetime.FOREVER) return;
  savePolicyKind(runtime, kind);
}

export function savePolicyKind(runtime: AgentRuntime, kind: PolicyCommandKind): void {
  switch (kind) {
    case PolicyCommandKind.IO:
      runtime.pathPolicyStore.save(runtime.pathPolicy);
      return;
    case PolicyCommandKind.SHELL:
      runtime.shellPolicyStore.save(runtime.shellPolicy);
      return;
    case PolicyCommandKind.CODE:
      runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
      return;
    case PolicyCommandKind.WEB:
      runtime.webPolicyStore.save(runtime.webPolicy);
      return;
    case PolicyCommandKind.ALL:
      saveRuntimeStores(runtime);
      return;
  }
}

export function clearPolicyKind(runtime: AgentRuntime, kind: PolicyCommandKind): void {
  switch (kind) {
    case PolicyCommandKind.IO:
      runtime.pathPolicy.removePolicies(runtime.pathPolicy.policiesSnapshot().map((policy): PathPolicyDeleteRequest => ({
        path: policy.path,
        accessTypes: Object.values(FsAccessType),
      })));
      runtime.pathPolicyStore.save(runtime.pathPolicy);
      return;
    case PolicyCommandKind.SHELL:
      runtime.shellPolicy.removePolicies(runtime.shellPolicy.policiesSnapshot().map((policy): ShellPolicyDeleteRequest => ({
        commandArgs: policy.commandArgs,
        removeEntirePolicy: true,
        flags: [],
      })));
      runtime.shellPolicyStore.save(runtime.shellPolicy);
      return;
    case PolicyCommandKind.CODE:
      runtime.codeExecPolicy.removePolicies(runtime.codeExecPolicy.policiesSnapshot().map((policy): CodeExecPolicyDeleteRequest => ({
        language: policy.language,
        mode: policy.mode,
      })));
      runtime.codeExecPolicyStore.save(runtime.codeExecPolicy);
      return;
    case PolicyCommandKind.WEB:
      runtime.webPolicy.removePolicies(runtime.webPolicy.policiesSnapshot().map((policy): WebPolicyDeleteRequest => ({
        host: policy.host,
        path: policy.path,
        accessType: policy.accessType,
      })));
      runtime.webPolicyStore.save(runtime.webPolicy);
      return;
    case PolicyCommandKind.ALL:
      clearPolicyKind(runtime, PolicyCommandKind.IO);
      clearPolicyKind(runtime, PolicyCommandKind.SHELL);
      clearPolicyKind(runtime, PolicyCommandKind.CODE);
      clearPolicyKind(runtime, PolicyCommandKind.WEB);
      return;
  }
}

export function completionValues(values: readonly string[], prefix: string): AutocompleteItem[] {
  const parts = prefix.trimStart().split(/\s+/);
  const current = prefix.endsWith(" ") ? "" : parts[parts.length - 1] ?? "";
  const base = prefix.slice(0, prefix.length - current.length);
  return values
    .filter((value) => value.startsWith(current))
    .map((value) => ({value: `${base}${value}`, label: value}));
}

export function commonCompletions(
  prefix: string,
  actions: readonly PolicyCommandAction[] = Object.values(PolicyCommandAction),
): AutocompleteItem[] {
  const tokens = tokenizePolicyCommandArgs(prefix);
  if (tokens.length <= 1 && !prefix.endsWith(" ")) return completionValues(actions, prefix);
  return completionValues([
    ...Object.values(FsAccessType),
    ...Object.values(WebAccessType),
    ...Object.values(PolicyCommandLifetimeArg),
    PolicyCommandOption.LIFETIME,
    PolicyCommandOption.REASON,
    PolicyCommandOption.YES,
  ], prefix);
}

function emptyOptions(): CommonPolicyCommandOptions {
  return {
    lifetime: defaultPolicyCommandLifetime,
    lifetimeSpecified: false,
    reasonSpecified: false,
    yes: false,
    flags: [],
    allFlags: false,
    entire: false,
    operands: [],
  };
}
