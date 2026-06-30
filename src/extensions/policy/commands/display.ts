import {
  CodeExecPolicy,
  CodeExecPolicyResult,
  FsAccessType,
  PathPolicy,
  PathPolicyResult,
  PolicyLifetime,
  PolicyStatus,
  ShellFlagPolicyStatus,
  ShellPolicy,
  ShellPolicyResult,
  ShellPolicyScopeOption,
  WebAccessType,
  WebPolicy,
  WebPolicyResult,
} from "../../../policy/types";

export enum PolicyCommandDisplayText {
  UNKNOWN = "UNKNOWN",
  NO_MATCH = "no matching policy",
  NO_PENDING_SCOPES = "no pending scopes",
  RESULT = "result",
  COMMAND = "command",
  ALL_FLAGS = "all flags",
  FLAGS = "flags",
  FLAG = "flag",
}

export enum PolicyCommandSectionTitle {
  IO = "IO policies",
  SHELL = "Shell policies",
  CODE = "Code execution policies",
  WEB = "Web policies",
}

enum PolicyCommandIndent {
  SCOPE = "  ",
  STATUS = "    ",
  ITEM = "      ",
  EVAL = "  ",
  EVAL_DETAIL = "    ",
}

const policyStatusDisplayOrder = [PolicyStatus.ALLOWED, PolicyStatus.DENIED] as const;
const ioAccessDisplayOrder = [FsAccessType.READ, FsAccessType.WRITE, FsAccessType.EDIT, FsAccessType.DELETE, FsAccessType.EXECUTE] as const;
const webAccessDisplayOrder = [WebAccessType.READ, WebAccessType.SEARCH] as const;

export function formatIoPoliciesList(policies: PathPolicy[]): string {
  return formatGroupedPolicies(PolicyCommandSectionTitle.IO, policies.map((policy) => ({
    scope: policy.path,
    items: ioAccessDisplayOrder.flatMap((accessType) => {
      const status = policy.info[accessType];
      return status ? [{label: accessType, status: status.status, lifetime: status.lifetime}] : [];
    }),
  })));
}

export function formatIoEvaluations(policyPath: string, rows: Array<{accessType: FsAccessType; result: PathPolicyResult | null}>): string {
  return [
    `IO evaluation ${policyPath}`,
    ...rows.map(({accessType, result}) => result
      ? `${PolicyCommandIndent.EVAL}${accessType} ${result.matchedStatus} via ${result.matchedPattern} (${formatLifetime(result.matchedLifetime)})`
      : `${PolicyCommandIndent.EVAL}${accessType} ${PolicyCommandDisplayText.UNKNOWN}`),
  ].join("\n");
}

export function formatWebPoliciesList(policies: WebPolicy[]): string {
  const scopes = new Map<string, GroupedPolicyScope>();
  for (const policy of policies) {
    const scope = formatWebScope(policy.host, policy.path);
    const grouped = scopes.get(scope) ?? {scope, items: []};
    grouped.items.push({label: policy.accessType, status: policy.status, lifetime: policy.lifetime});
    scopes.set(scope, grouped);
  }
  for (const grouped of scopes.values()) grouped.items.sort((left, right) => accessIndex(webAccessDisplayOrder, left.label) - accessIndex(webAccessDisplayOrder, right.label));
  return formatGroupedPolicies(PolicyCommandSectionTitle.WEB, [...scopes.values()]);
}

export function formatWebEvaluations(url: string, rows: Array<{accessType: string; result: WebPolicyResult | null}>): string {
  return [
    `Web evaluation ${url}`,
    ...rows.map(({accessType, result}) => result
      ? `${PolicyCommandIndent.EVAL}${accessType} ${result.matchedStatus} via ${result.matchedScope} (${formatLifetime(result.matchedLifetime)})`
      : `${PolicyCommandIndent.EVAL}${accessType} ${PolicyCommandDisplayText.UNKNOWN}`),
  ].join("\n");
}

export function formatCodePoliciesList(policies: CodeExecPolicy[]): string {
  const scopes = new Map<string, GroupedPolicyScope>();
  for (const policy of policies) {
    const grouped = scopes.get(policy.language) ?? {scope: policy.language, items: []};
    grouped.items.push({label: policy.mode, status: policy.status, lifetime: policy.lifetime});
    scopes.set(policy.language, grouped);
  }
  return formatGroupedPolicies(PolicyCommandSectionTitle.CODE, [...scopes.values()]);
}

export function formatCodeEvaluation(language: string, mode: string, result: CodeExecPolicyResult | null): string {
  const target = `${language} ${mode}`;
  return [
    `Code evaluation ${target}`,
    result
      ? `${PolicyCommandIndent.EVAL}${result.matchedStatus} via ${result.matchedScope} (${formatLifetime(result.matchedLifetime)})`
      : `${PolicyCommandIndent.EVAL}${PolicyCommandDisplayText.UNKNOWN}`,
  ].join("\n");
}

export function formatShellPoliciesList(policies: ShellPolicy[]): string {
  return formatGroupedPolicies(PolicyCommandSectionTitle.SHELL, policies.map((policy) => ({
    scope: policy.commandArgs.join(" "),
    items: shellPolicyItems(policy),
  })));
}

export function formatShellEvaluation(command: string, result: ShellPolicyResult | null, pendingScopes: ShellPolicyScopeOption[]): string {
  if (!result) {
    const pending = pendingScopes.length > 0
      ? ["Pending scopes", ...pendingScopes.map((scope) => `${PolicyCommandIndent.EVAL}${scope.label}`)]
      : [`Pending scopes ${PolicyCommandDisplayText.NO_PENDING_SCOPES}`];
    return [
      `Shell evaluation ${command}`,
      `${PolicyCommandIndent.EVAL}${PolicyCommandDisplayText.RESULT} ${PolicyCommandDisplayText.UNKNOWN}`,
      `${PolicyCommandIndent.EVAL}${PolicyCommandDisplayText.NO_MATCH}`,
      ...pending,
    ].join("\n");
  }

  return [
    `Shell evaluation ${command}`,
    `${PolicyCommandIndent.EVAL}${PolicyCommandDisplayText.RESULT} ${result.allowed ? PolicyStatus.ALLOWED : PolicyStatus.DENIED}`,
    ...result.segmentResults.flatMap((segment) => [
      `${PolicyCommandIndent.EVAL}${segment.commandPrefix.join(" ") || "(none)"} ${segment.status} (${formatLifetime(segment.lifetime)})`,
      ...segment.flags.map(formatShellFlagEvaluation),
    ]),
  ].join("\n");
}

export function formatPolicySections(...sections: string[]): string {
  return sections.join("\n\n");
}

type GroupedPolicyItem = {
  label: string;
  status: PolicyStatus;
  lifetime: PolicyLifetime;
  mergeGroup?: string;
};

type GroupedPolicyScope = {
  scope: string;
  items: GroupedPolicyItem[];
};

function formatGroupedPolicies(title: PolicyCommandSectionTitle, scopes: GroupedPolicyScope[]): string {
  const nonEmptyScopes = scopes.filter((scope) => scope.items.length > 0);
  if (nonEmptyScopes.length === 0) return `${title}\n${PolicyCommandIndent.SCOPE}none`;

  return [
    title,
    nonEmptyScopes.map(formatGroupedScope).join("\n\n"),
  ].join("\n");
}

function formatGroupedScope(scope: GroupedPolicyScope): string {
  return [
    `${PolicyCommandIndent.SCOPE}${scope.scope}`,
    ...policyStatusDisplayOrder.flatMap((status) => formatStatusGroup(status, scope.items)),
  ].join("\n");
}

function formatStatusGroup(status: PolicyStatus, items: GroupedPolicyItem[]): string[] {
  const matching = items.filter((item) => item.status === status);
  if (matching.length === 0) return [];
  const groups = new Map<string, {lifetime: PolicyLifetime; labels: string[]}>();
  for (const item of matching) {
    const key = `${item.lifetime}\u0000${item.mergeGroup ?? ""}`;
    const group = groups.get(key) ?? {lifetime: item.lifetime, labels: []};
    group.labels.push(item.label);
    groups.set(key, group);
  }

  return [
    `${PolicyCommandIndent.STATUS}${status}`,
    ...[...groups.values()].map((group) => `${PolicyCommandIndent.ITEM}${group.labels.join(", ")} (${formatLifetime(group.lifetime)})`),
  ];
}

function shellPolicyItems(policy: ShellPolicy): GroupedPolicyItem[] {
  const items: GroupedPolicyItem[] = [{
    label: PolicyCommandDisplayText.COMMAND,
    status: policy.status,
    lifetime: policy.lifetime,
    mergeGroup: PolicyCommandDisplayText.COMMAND,
  }];
  const flagGroups = new Map<string, {flags: string[]; status: PolicyStatus; lifetime: PolicyLifetime}>();
  for (const flag of Object.values(policy.flags)) {
    const key = `${flag.status}\u0000${flag.lifetime}`;
    const group = flagGroups.get(key) ?? {flags: [], status: flag.status, lifetime: flag.lifetime};
    group.flags.push(flag.flag);
    flagGroups.set(key, group);
  }
  for (const group of flagGroups.values()) items.push({
    label: `${PolicyCommandDisplayText.FLAGS} ${group.flags.join(", ")}`,
    status: group.status,
    lifetime: group.lifetime,
    mergeGroup: PolicyCommandDisplayText.FLAGS,
  });
  if (policy.allowAllFlags) items.push({
    label: PolicyCommandDisplayText.ALL_FLAGS,
    status: PolicyStatus.ALLOWED,
    lifetime: policy.lifetime,
    mergeGroup: PolicyCommandDisplayText.ALL_FLAGS,
  });
  return items;
}

function formatShellFlagEvaluation(flag: ShellFlagPolicyStatus): string {
  return `${PolicyCommandIndent.EVAL_DETAIL}${PolicyCommandDisplayText.FLAG} ${flag.flag} ${flag.status} (${formatLifetime(flag.lifetime)})`;
}

function formatLifetime(lifetime: PolicyLifetime): string {
  return lifetime.toLowerCase();
}

function formatWebScope(host: string, path: string): string {
  return path === "/" ? host : `${host}${path}`;
}

function accessIndex<T extends string>(order: readonly T[], value: string): number {
  const index = order.indexOf(value as T);
  return index >= 0 ? index : order.length;
}
