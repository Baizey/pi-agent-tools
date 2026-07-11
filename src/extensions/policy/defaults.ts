import {AutocompleteItem, PiExtensionApi} from "../../pi/types";
import {FsAccessType, WebAccessType} from "../../policy/types";
import {AgentEnvName, agentEnv, isAgentEnvEnabled} from "../../shared/env";

export enum PolicyDefaultAction {
  SHOW = "show",
  ALLOW = "allow",
  DENY = "deny",
  ASK = "ask",
  RESET = "reset",
}

export enum PolicyDefaultMode {
  ASK = "ask",
  ALLOW = "allow",
  DENY = "deny",
}

export enum PolicyDefaultCommandScope {
  ROOT = "root",
  SUBAGENTS = "subagents",
  ALL = "all",
}

export type PolicyDefaultStoredScope = PolicyDefaultCommandScope.ROOT | PolicyDefaultCommandScope.SUBAGENTS;

export enum PolicyDefaultTarget {
  ALL = "all",
  IO = "io",
  IO_READ = "io_read",
  IO_WRITE = "io_write",
  IO_EXECUTE = "io_execute",
  SHELL = "shell",
  CODE = "code",
  WEB = "web",
  WEB_READ = "web_read",
  WEB_SEARCH = "web_search",
}

const targetAliases: Record<string, PolicyDefaultTarget> = {
  path: PolicyDefaultTarget.IO,
  filesystem: PolicyDefaultTarget.IO,
  fs: PolicyDefaultTarget.IO,
  bash: PolicyDefaultTarget.SHELL,
  execute_bash: PolicyDefaultTarget.SHELL,
  execute_code: PolicyDefaultTarget.CODE,
};

export type PolicyDefaultOverrides = {
  path: Partial<Record<FsAccessType, PolicyDefaultMode>>;
  shell?: PolicyDefaultMode;
  code?: PolicyDefaultMode;
  web: Partial<Record<WebAccessType, PolicyDefaultMode>>;
};

export type PolicyDefaultSnapshot = {
  root: PolicyDefaultOverrides;
  subagents: PolicyDefaultOverrides;
};

type PolicyDefaultKey =
  | {kind: "path"; accessType: FsAccessType}
  | {kind: "shell"}
  | {kind: "code"}
  | {kind: "web"; accessType: WebAccessType};

export type ParsedPolicyDefaultCommand =
  | {action: PolicyDefaultAction.SHOW}
  | {
    action: PolicyDefaultAction.ALLOW | PolicyDefaultAction.DENY | PolicyDefaultAction.ASK | PolicyDefaultAction.RESET;
    targets: PolicyDefaultTarget[];
    scope: PolicyDefaultCommandScope;
  };

export type PolicyDefaultCommandParseResult = ParsedPolicyDefaultCommand | {error: string};

const inherited = parsePolicyDefaultsEnv(process.env[agentEnv.policyDefaults]);
const state: PolicyDefaultSnapshot = {
  root: cloneOverrides(inherited),
  subagents: cloneOverrides(inherited),
};

export function registerPolicyDefaultCommand(pi: PiExtensionApi): void {
  pi.on("session_start", (event) => {
    if (event.reason !== "reload") resetPolicyDefaultState();
  });

  pi.registerCommand?.("policy-default", {
    description: "Show or set session default responses for unmatched policy checks.",
    getArgumentCompletions: policyDefaultCommandCompletions,
    handler(args, ctx) {
      const parsed = parsePolicyDefaultCommand(args);
      if ("error" in parsed) {
        ctx.ui?.notify?.(`${parsed.error}\n\n${policyDefaultUsage()}`, "error");
        return;
      }

      if (parsed.action !== "show") applyPolicyDefaultCommand(parsed);
      ctx.ui?.notify?.(formatPolicyDefaultSnapshot(), "info");
    },
  });
}

export function parsePolicyDefaultCommand(args: string): PolicyDefaultCommandParseResult {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return {action: PolicyDefaultAction.SHOW};

  const action = tokens.shift() as string;
  if (!isPolicyDefaultAction(action)) return {error: `Unknown /policy-default action: ${action}`};
  if (action === PolicyDefaultAction.SHOW) {
    return tokens.length === 0 ? {action} : {error: "Usage: /policy-default show"};
  }

  const targets: PolicyDefaultTarget[] = [];
  let scope = PolicyDefaultCommandScope.ROOT;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "--scope") {
      const value = tokens[++index];
      if (!value) return {error: "Missing value for --scope."};
      const normalizedScope = normalizePolicyDefaultScope(value);
      if (!normalizedScope) return {error: `Unknown policy default scope: ${value}`};
      scope = normalizedScope;
      continue;
    }
    if (token.startsWith("--scope=")) {
      const value = token.slice("--scope=".length);
      const normalizedScope = normalizePolicyDefaultScope(value);
      if (!normalizedScope) return {error: `Unknown policy default scope: ${value}`};
      scope = normalizedScope;
      continue;
    }
    if (token.startsWith("--")) return {error: `Unknown /policy-default option: ${token}`};

    const target = normalizePolicyDefaultTarget(token);
    if (!target) return {error: `Unknown policy default target: ${token}`};
    if (!targets.includes(target)) targets.push(target);
  }

  if (targets.length === 0) return {error: `Missing target for /policy-default ${action}.`};
  return {action, targets, scope};
}

export function applyPolicyDefaultCommand(command: Exclude<ParsedPolicyDefaultCommand, {action: PolicyDefaultAction.SHOW}>): void {
  const scopes: PolicyDefaultStoredScope[] = command.scope === PolicyDefaultCommandScope.ALL
    ? [PolicyDefaultCommandScope.ROOT, PolicyDefaultCommandScope.SUBAGENTS]
    : [command.scope];
  const keys = command.targets.flatMap(expandPolicyDefaultTarget);
  for (const scope of scopes) {
    for (const key of keys) {
      setPolicyDefault(
        scope,
        key,
        command.action === PolicyDefaultAction.RESET ? undefined : policyDefaultModeForAction(command.action),
      );
    }
  }
}

export function currentPathPolicyDefault(accessType: FsAccessType, denyByDefault: boolean): PolicyDefaultMode {
  return state.root.path[accessType] ?? basePolicyDefaultMode(denyByDefault);
}

export function currentShellPolicyDefault(denyByDefault: boolean): PolicyDefaultMode {
  return state.root.shell ?? basePolicyDefaultMode(denyByDefault);
}

export function currentCodeExecPolicyDefault(denyByDefault: boolean): PolicyDefaultMode {
  return state.root.code ?? basePolicyDefaultMode(denyByDefault);
}

export function currentWebPolicyDefault(accessType: WebAccessType, denyByDefault: boolean): PolicyDefaultMode {
  return state.root.web[accessType] ?? basePolicyDefaultMode(denyByDefault);
}

export function policyDefaultsEnvForSubagents(): Partial<Record<AgentEnvName, string>> {
  return {[agentEnv.policyDefaults]: serializePolicyDefaultOverrides(state.subagents)};
}

export function policyDefaultSnapshot(): PolicyDefaultSnapshot {
  return {
    root: cloneOverrides(state.root),
    subagents: cloneOverrides(state.subagents),
  };
}

export function formatPolicyDefaultSnapshot(snapshot: PolicyDefaultSnapshot = policyDefaultSnapshot()): string {
  return [
    "Policy default responses (session-only; explicit policies still win):",
    ...formatScope(PolicyDefaultCommandScope.ROOT, snapshot.root, rootBaseDefaults()),
    ...formatScope(PolicyDefaultCommandScope.SUBAGENTS, snapshot.subagents, denyBaseDefaults()),
  ].join("\n");
}

export function policyDefaultCommandCompletions(prefix: string): AutocompleteItem[] | null {
  const context = completionContext(prefix);
  const first = context.tokens[0];

  if (!first || context.tokens.length === 0) return completeValues(Object.values(PolicyDefaultAction), context.current, context.base);
  if (context.tokens.length === 1 && !prefix.endsWith(" ")) return completeValues(Object.values(PolicyDefaultAction), context.current, context.base);
  if (first === PolicyDefaultAction.SHOW) return null;
  if (!isPolicyDefaultAction(first) || first === PolicyDefaultAction.SHOW) return null;

  if (context.previous === "--scope") return completeValues(Object.values(PolicyDefaultCommandScope), context.current, context.base);
  if (context.current.startsWith("--scope=")) {
    const valuePrefix = context.current.slice("--scope=".length);
    return Object.values(PolicyDefaultCommandScope)
      .filter((scope) => scope.startsWith(valuePrefix))
      .map((scope) => ({value: `${context.base}--scope=${scope}`, label: `--scope=${scope}`}));
  }
  if (context.current.startsWith("--")) {
    return completeValues(["--scope", "--scope=root", "--scope=subagents", "--scope=all"], context.current, context.base);
  }

  const completedTargetTokens = context.current === "" ? context.tokens.slice(1) : context.tokens.slice(1, -1);
  const usedTargets = new Set(completedTargetTokens.map(normalizePolicyDefaultTarget).filter((value): value is PolicyDefaultTarget => Boolean(value)));
  const targets = Object.values(PolicyDefaultTarget)
    .filter((target) => !usedTargets.has(target) || target === PolicyDefaultTarget.ALL);
  return completeValues([...targets, "--scope"], context.current, context.base);
}

export function resetPolicyDefaultsForTest(): void {
  resetPolicyDefaultState(createEmptyOverrides());
}

function resetPolicyDefaultState(overrides = parsePolicyDefaultsEnv(process.env[agentEnv.policyDefaults])): void {
  state.root = cloneOverrides(overrides);
  state.subagents = cloneOverrides(overrides);
}

function setPolicyDefault(scope: PolicyDefaultStoredScope, key: PolicyDefaultKey, mode: PolicyDefaultMode | undefined): void {
  const target = state[scope];
  switch (key.kind) {
    case "path":
      if (mode) target.path[key.accessType] = mode;
      else delete target.path[key.accessType];
      return;
    case "shell":
      target.shell = mode;
      return;
    case "code":
      target.code = mode;
      return;
    case "web":
      if (mode) target.web[key.accessType] = mode;
      else delete target.web[key.accessType];
      return;
  }
}

function expandPolicyDefaultTarget(target: PolicyDefaultTarget): PolicyDefaultKey[] {
  switch (target) {
    case PolicyDefaultTarget.ALL:
      return [
        ...expandPolicyDefaultTarget(PolicyDefaultTarget.IO),
        ...expandPolicyDefaultTarget(PolicyDefaultTarget.SHELL),
        ...expandPolicyDefaultTarget(PolicyDefaultTarget.CODE),
        ...expandPolicyDefaultTarget(PolicyDefaultTarget.WEB),
      ];
    case PolicyDefaultTarget.IO:
      return Object.values(FsAccessType).map((accessType) => ({kind: "path", accessType}) as const);
    case PolicyDefaultTarget.IO_READ:
      return [{kind: "path", accessType: FsAccessType.READ}];
    case PolicyDefaultTarget.IO_WRITE:
      return [FsAccessType.WRITE, FsAccessType.EDIT, FsAccessType.DELETE].map((accessType) => ({kind: "path", accessType}) as const);
    case PolicyDefaultTarget.IO_EXECUTE:
      return [{kind: "path", accessType: FsAccessType.EXECUTE}];
    case PolicyDefaultTarget.SHELL:
      return [{kind: "shell"}];
    case PolicyDefaultTarget.CODE:
      return [{kind: "code"}];
    case PolicyDefaultTarget.WEB:
      return Object.values(WebAccessType).map((accessType) => ({kind: "web", accessType}) as const);
    case PolicyDefaultTarget.WEB_READ:
      return [{kind: "web", accessType: WebAccessType.READ}];
    case PolicyDefaultTarget.WEB_SEARCH:
      return [{kind: "web", accessType: WebAccessType.SEARCH}];
  }
}

function formatScope(scope: PolicyDefaultStoredScope, overrides: PolicyDefaultOverrides, base: PolicyDefaultBase): string[] {
  const mode = (configured: PolicyDefaultMode | undefined, inherited: PolicyDefaultMode) => configured ? configured : `${inherited} (inherited)`;
  return [
    `${scope}:`,
    `  io.READ: ${mode(overrides.path[FsAccessType.READ], base.path[FsAccessType.READ])}`,
    `  io.WRITE: ${mode(overrides.path[FsAccessType.WRITE], base.path[FsAccessType.WRITE])}`,
    `  io.EDIT: ${mode(overrides.path[FsAccessType.EDIT], base.path[FsAccessType.EDIT])}`,
    `  io.DELETE: ${mode(overrides.path[FsAccessType.DELETE], base.path[FsAccessType.DELETE])}`,
    `  io.EXECUTE: ${mode(overrides.path[FsAccessType.EXECUTE], base.path[FsAccessType.EXECUTE])}`,
    `  shell: ${mode(overrides.shell, base.shell)}`,
    `  code: ${mode(overrides.code, base.code)}`,
    `  web.READ: ${mode(overrides.web[WebAccessType.READ], base.web[WebAccessType.READ])}`,
    `  web.SEARCH: ${mode(overrides.web[WebAccessType.SEARCH], base.web[WebAccessType.SEARCH])}`,
  ];
}

type PolicyDefaultBase = {
  path: Record<FsAccessType, PolicyDefaultMode>;
  shell: PolicyDefaultMode;
  code: PolicyDefaultMode;
  web: Record<WebAccessType, PolicyDefaultMode>;
};

function rootBaseDefaults(): PolicyDefaultBase {
  const path = basePolicyDefaultMode(isAgentEnvEnabled(agentEnv.pathDenyByDefault));
  const web = basePolicyDefaultMode(isAgentEnvEnabled(agentEnv.webDenyByDefault));
  return {
    path: {
      [FsAccessType.READ]: path,
      [FsAccessType.WRITE]: path,
      [FsAccessType.EDIT]: path,
      [FsAccessType.DELETE]: path,
      [FsAccessType.EXECUTE]: path,
    },
    shell: basePolicyDefaultMode(isAgentEnvEnabled(agentEnv.shellDenyByDefault)),
    code: basePolicyDefaultMode(isAgentEnvEnabled(agentEnv.codeExecDenyByDefault)),
    web: {
      [WebAccessType.READ]: web,
      [WebAccessType.SEARCH]: web,
    },
  };
}

function denyBaseDefaults(): PolicyDefaultBase {
  return {
    path: {
      [FsAccessType.READ]: PolicyDefaultMode.DENY,
      [FsAccessType.WRITE]: PolicyDefaultMode.DENY,
      [FsAccessType.EDIT]: PolicyDefaultMode.DENY,
      [FsAccessType.DELETE]: PolicyDefaultMode.DENY,
      [FsAccessType.EXECUTE]: PolicyDefaultMode.DENY,
    },
    shell: PolicyDefaultMode.DENY,
    code: PolicyDefaultMode.DENY,
    web: {
      [WebAccessType.READ]: PolicyDefaultMode.DENY,
      [WebAccessType.SEARCH]: PolicyDefaultMode.DENY,
    },
  };
}

function basePolicyDefaultMode(denyByDefault: boolean): PolicyDefaultMode {
  return denyByDefault ? PolicyDefaultMode.DENY : PolicyDefaultMode.ASK;
}

function policyDefaultModeForAction(
  action: PolicyDefaultAction.ALLOW | PolicyDefaultAction.DENY | PolicyDefaultAction.ASK,
): PolicyDefaultMode {
  switch (action) {
    case PolicyDefaultAction.ALLOW:
      return PolicyDefaultMode.ALLOW;
    case PolicyDefaultAction.DENY:
      return PolicyDefaultMode.DENY;
    case PolicyDefaultAction.ASK:
      return PolicyDefaultMode.ASK;
  }
}

function normalizePolicyDefaultTarget(value: string): PolicyDefaultTarget | null {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (Object.values(PolicyDefaultTarget).some((target) => target === normalized)) return normalized as PolicyDefaultTarget;
  return targetAliases[normalized] ?? null;
}

function isPolicyDefaultAction(value: string): value is PolicyDefaultAction {
  return Object.values(PolicyDefaultAction).some((action) => action === value);
}

function normalizePolicyDefaultScope(value: string): PolicyDefaultCommandScope | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "agent") return PolicyDefaultCommandScope.ROOT;
  return Object.values(PolicyDefaultCommandScope).some((scope) => scope === normalized)
    ? normalized as PolicyDefaultCommandScope
    : null;
}

function serializePolicyDefaultOverrides(overrides: PolicyDefaultOverrides): string {
  return JSON.stringify(overrides);
}

function parsePolicyDefaultsEnv(value: string | undefined): PolicyDefaultOverrides {
  if (!value) return createEmptyOverrides();
  try {
    const parsed = JSON.parse(value) as Partial<PolicyDefaultOverrides>;
    return normalizeOverrides(parsed);
  } catch {
    return createEmptyOverrides();
  }
}

function normalizeOverrides(input: Partial<PolicyDefaultOverrides> | undefined): PolicyDefaultOverrides {
  const empty = createEmptyOverrides();
  if (!input || typeof input !== "object") return empty;

  for (const [accessType, mode] of Object.entries(input.path ?? {})) {
    if (isFsAccessType(accessType) && isPolicyDefaultMode(mode)) empty.path[accessType] = mode;
  }
  for (const [accessType, mode] of Object.entries(input.web ?? {})) {
    if (isWebAccessType(accessType) && isPolicyDefaultMode(mode)) empty.web[accessType] = mode;
  }
  if (isPolicyDefaultMode(input.shell)) empty.shell = input.shell;
  if (isPolicyDefaultMode(input.code)) empty.code = input.code;
  return empty;
}

function isPolicyDefaultMode(value: unknown): value is PolicyDefaultMode {
  return typeof value === "string" && Object.values(PolicyDefaultMode).some((mode) => mode === value);
}

function isFsAccessType(value: string): value is FsAccessType {
  return (Object.values(FsAccessType) as string[]).includes(value);
}

function isWebAccessType(value: string): value is WebAccessType {
  return (Object.values(WebAccessType) as string[]).includes(value);
}

function createEmptyOverrides(): PolicyDefaultOverrides {
  return {path: {}, web: {}};
}

function cloneOverrides(overrides: PolicyDefaultOverrides): PolicyDefaultOverrides {
  return {
    path: {...overrides.path},
    shell: overrides.shell,
    code: overrides.code,
    web: {...overrides.web},
  };
}

function completeValues(values: readonly string[], prefix: string, base: string): AutocompleteItem[] | null {
  const items = values
    .filter((value) => value.startsWith(prefix))
    .map((value) => ({value: `${base}${value}`, label: value}));
  return items.length > 0 ? items : null;
}

function completionContext(prefix: string): {tokens: string[]; current: string; base: string; previous?: string} {
  const tokens = prefix.trim().length > 0 ? prefix.trim().split(/\s+/) : [];
  if (prefix.endsWith(" ")) {
    return {tokens, current: "", base: prefix, previous: tokens[tokens.length - 1]};
  }

  const current = tokens[tokens.length - 1] ?? "";
  const base = current ? prefix.slice(0, prefix.length - current.length) : prefix;
  return {tokens, current, base, previous: tokens.length >= 2 ? tokens[tokens.length - 2] : undefined};
}

function policyDefaultUsage(): string {
  return [
    "/policy-default show",
    "/policy-default allow <target...> [--scope root|subagents|all]",
    "/policy-default deny <target...> [--scope root|subagents|all]",
    "/policy-default ask <target...> [--scope root|subagents|all]",
    "/policy-default reset <target...> [--scope root|subagents|all]",
    `Targets: ${Object.values(PolicyDefaultTarget).join(", ")}`,
  ].join("\n");
}
