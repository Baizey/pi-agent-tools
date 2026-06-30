import {
  isPersistedLifetime,
  PolicyLifetime,
  PolicyResolutionSource,
  policyResolutionSourceText,
  PolicyStatus,
  ShellFlagPolicyStatus,
  ShellPolicy,
  ShellPolicyDeleteRequest,
  ShellPolicyResult,
  ShellPolicyScopeOption,
  ShellSegmentPolicyResult,
} from "../types";

export type ShellPolicyLogicOptions = {
  policies?: ShellPolicy[];
};

export class ShellPolicyLogic {
  static createPolicy(
    commandArgs: string | string[],
    status: PolicyStatus,
    lifetime: PolicyLifetime,
    reason: string,
    flags: ShellFlagPolicyStatus[] = [],
    allowAllFlags = false,
  ): ShellPolicy {
    const normalizedCommandArgs = Array.isArray(commandArgs) ? commandArgs : tokenizeShellSegment(commandArgs).map((token) => token.value);
    return {
      commandArgs: normalizedCommandArgs,
      flags: Object.fromEntries(flags.map((flag) => [flag.flag, { ...flag }])),
      allowAllFlags,
      lifetime,
      status,
      reason,
    };
  }

  static createFlagStatus(
    flag: string,
    status: PolicyStatus,
    lifetime: PolicyLifetime,
    reason: string,
  ): ShellFlagPolicyStatus {
    return { flag, lifetime, status, reason };
  }

  private readonly policies = new ShellPolicyTree();

  constructor(options: ShellPolicyLogicOptions = {}) {
    if (options.policies) this.addPolicies(options.policies);
  }

  evaluate(command: string, denyByDefault = false): ShellPolicyResult | null {
    const segmentResults: ShellSegmentPolicyResult[] = [];
    const segments = splitShellSegments(command);
    let hasUnknownSegment = false;

    for (const segment of segments.length === 0 ? [command] : segments) {
      const result = this.evaluateSegment(segment, denyByDefault);
      if (result === null) {
        hasUnknownSegment = true;
        continue;
      }
      segmentResults.push(result);
    }

    if (segmentResults.some((result) => result.denied)) return this.result(command, segmentResults);
    if (hasUnknownSegment) return null;
    return this.result(command, segmentResults);
  }

  pendingPolicyScopeOptions(command: string): ShellPolicyScopeOption[] {
    const segments = splitShellSegments(command);
    for (const segment of segments.length === 0 ? [command] : segments) {
      const options = this.pendingPolicyScopeOptionsForSegment(segment);
      if (options.length > 0) return options;
    }
    return [];
  }

  addPolicies(policies: ShellPolicy[]): void {
    this.policies.addPolicies(policies.map((policy) => this.standardizePolicy(policy)));
  }

  createPolicyForScope(
    scope: ShellPolicyScopeOption,
    status: PolicyStatus,
    lifetime: PolicyLifetime,
    reason: string,
  ): ShellPolicy {
    const existingCommandPolicy = scope.flags.length > 0 || scope.allowAllFlags
      ? this.policies.findExactPolicy(scope.commandArgs) ?? this.policies.findCommandPolicy(scope.commandArgs)
      : undefined;

    return ShellPolicyLogic.createPolicy(
      scope.commandArgs,
      existingCommandPolicy?.status ?? status,
      existingCommandPolicy?.lifetime ?? lifetime,
      existingCommandPolicy?.reason ?? reason,
      scope.flags.map((flag) => ShellPolicyLogic.createFlagStatus(flag, status, lifetime, reason)),
      scope.allowAllFlags === true || existingCommandPolicy?.allowAllFlags === true,
    );
  }

  removePolicies(policies: ShellPolicyDeleteRequest[]): void {
    for (const policy of policies) this.policies.removePolicy(this.standardizeDeleteRequest(policy));
  }

  policiesSnapshot(): ShellPolicy[] {
    return this.policies.policiesSnapshot();
  }

  persistedPolicies(): ShellPolicy[] {
    return this.policies.persistedPolicies().sort((left, right) => {
      const byFirst = (left.commandArgs[0] ?? "").localeCompare(right.commandArgs[0] ?? "");
      if (byFirst !== 0) return byFirst;
      const bySize = left.commandArgs.length - right.commandArgs.length;
      if (bySize !== 0) return bySize;
      return describePolicy(left).localeCompare(describePolicy(right));
    });
  }

  toDenyReasonOrNull(result: ShellPolicyResult): string | null {
    if (result.allowed) return null;
    return [
      "EXECUTION DENIED",
      "The following shell policy checks failed:",
      ...result.segmentResults.filter((it) => it.denied).map((it) => this.segmentDenyReason(it)),
    ].join("\n");
  }

  private evaluateSegment(rawSegment: string, denyByDefault: boolean): ShellSegmentPolicyResult | null {
    return this.evaluateTokens(rawSegment, tokenizeShellSegment(rawSegment), denyByDefault);
  }

  private pendingPolicyScopeOptionsForSegment(segment: string): ShellPolicyScopeOption[] {
    const parsed = this.parseSafeSegment(segment);
    if (!parsed) return [];

    const commandPolicy = this.policies.findCommandPolicy(parsed.commandPrefix);
    if (!commandPolicy) return this.commandScopeOptions(parsed.commandPrefix, parsed.commandPrefix.length > 1);
    if (commandPolicy.status === PolicyStatus.DENIED) return [];

    const exactFlagPolicy = this.policies.findExactPolicy(parsed.commandPrefix);
    if (exactFlagPolicy?.allowAllFlags) return [];
    const unknownFlags = parsed.flags.filter((flag) => !exactFlagPolicy?.flags[flag]);
    if (unknownFlags.length === 0) return [];
    return this.flagScopeOptions(parsed.commandPrefix, unknownFlags);
  }

  private parseSafeSegment(segment: string): { commandPrefix: string[]; flags: string[] } | null {
    const tokens = tokenizeShellSegment(segment);
    const commandPrefix = commandPrefixFor(tokens);
    if (commandPrefix.length === 0 || hasUnsafeShellSyntax(segment, tokens)) return null;
    return {
      commandPrefix,
      flags: flagsForTokens(tokens, commandPrefix.length),
    };
  }

  private commandScopeOptions(commandPrefix: string[], includeAllFlagsOption: boolean): ShellPolicyScopeOption[] {
    const options: ShellPolicyScopeOption[] = [];
    for (let size = commandPrefix.length; size >= 1; size--) {
      const scopedCommand = commandPrefix.slice(0, size);
      options.push({
        label: scopedCommand.join(" "),
        commandArgs: scopedCommand,
        flags: [],
      });
      if (includeAllFlagsOption && size === commandPrefix.length) {
        options.push({
          label: `${scopedCommand.join(" ")} | with all flags allowed`,
          commandArgs: scopedCommand,
          flags: [],
          allowAllFlags: true,
        });
      }
    }
    return options;
  }

  private flagScopeOptions(commandPrefix: string[], flags: string[]): ShellPolicyScopeOption[] {
    return [
      ...flags.map((flag) => ({
        label: `${commandPrefix.join(" ")} flag ${flag}`,
        commandArgs: commandPrefix,
        flags: [flag],
      })),
      {
        label: `${commandPrefix.join(" ")} | with all flags allowed`,
        commandArgs: commandPrefix,
        flags: [],
        allowAllFlags: true,
      },
    ];
  }

  private evaluateTokens(rawSegment: string, tokens: ShellToken[], denyByDefault: boolean): ShellSegmentPolicyResult | null {
    const commandPrefix = commandPrefixFor(tokens);
    if (commandPrefix.length === 0) {
      return this.deniedSegment(rawSegment, commandPrefix, [], denyByDefault, "No command found in shell segment.");
    }

    const flagTokens = flagsForTokens(tokens, commandPrefix.length);
    const flagResults = flagTokens.map((flag) => this.defaultFlagStatus(flag, denyByDefault));

    if (hasUnsafeShellSyntax(rawSegment, tokens)) {
      return this.deniedSegment(
        rawSegment,
        commandPrefix,
        flagResults,
        denyByDefault,
        "Shell expansion or redirection is not allowed in shell policy evaluation.",
      );
    }

    const commandPolicy = this.policies.findCommandPolicy(commandPrefix);
    const exactFlagPolicy = this.policies.findExactPolicy(commandPrefix);
    const resolvedFlagResults = flagTokens.map((flag) => {
      if (exactFlagPolicy?.flags[flag]) return { ...exactFlagPolicy.flags[flag] };
      if (exactFlagPolicy?.allowAllFlags) return this.allFlagsAllowedStatus(flag, exactFlagPolicy);
      return this.defaultFlagStatus(flag, denyByDefault);
    });

    if (!commandPolicy) {
      if (!denyByDefault) return null;
      return this.deniedSegment(
        rawSegment,
        commandPrefix,
        resolvedFlagResults,
        denyByDefault,
        "No matching shell command policy found.",
      );
    }

    const hasUnknownFlags = resolvedFlagResults.some(
      (flag) => flag.status === PolicyStatus.DENIED && !exactFlagPolicy?.flags[flag.flag],
    );
    if (commandPolicy.status !== PolicyStatus.DENIED && !denyByDefault && hasUnknownFlags) return null;

    return this.segmentResult({
      rawSegment,
      commandPrefix,
      flags: resolvedFlagResults,
      lifetime: commandPolicy.lifetime,
      status: commandPolicy.status,
      reason: commandPolicy.reason,
      resolutionSource: PolicyResolutionSource.EXISTING_USER_POLICY,
    });
  }

  private deniedSegment(
    rawSegment: string,
    commandPrefix: string[],
    flags: ShellFlagPolicyStatus[],
    denyByDefault: boolean,
    reason: string,
  ): ShellSegmentPolicyResult {
    return this.segmentResult({
      rawSegment,
      commandPrefix,
      flags,
      lifetime: denyByDefault ? PolicyLifetime.FOREVER : PolicyLifetime.ONCE,
      status: PolicyStatus.DENIED,
      reason: denyByDefault
        ? `${reason} denied by default, you cannot execute this.`
        : `${reason} Ask for permission if you want to proceed.`,
      resolutionSource: PolicyResolutionSource.SYSTEM,
    });
  }

  private defaultFlagStatus(flag: string, denyByDefault: boolean): ShellFlagPolicyStatus {
    return {
      flag,
      lifetime: denyByDefault ? PolicyLifetime.FOREVER : PolicyLifetime.ONCE,
      status: PolicyStatus.DENIED,
      reason: denyByDefault
        ? "No matching shell flag policy found. denied by default, you cannot execute this."
        : "No matching shell flag policy found. Ask for permission if you want to proceed.",
    };
  }

  private allFlagsAllowedStatus(flag: string, policy: ShellPolicy): ShellFlagPolicyStatus {
    return {
      flag,
      lifetime: policy.lifetime,
      status: PolicyStatus.ALLOWED,
      reason: `All flags are allowed for '${policy.commandArgs.join(" ")}'. ${policy.reason}`.trim(),
    };
  }

  private result(command: string, segmentResults: ShellSegmentPolicyResult[]): ShellPolicyResult {
    return {
      command,
      segmentResults,
      resolutionSource: segmentResults.some((it) => it.resolutionSource === PolicyResolutionSource.SYSTEM)
        ? PolicyResolutionSource.SYSTEM
        : PolicyResolutionSource.EXISTING_USER_POLICY,
      allowed: segmentResults.every((it) => it.allowed),
      denied: segmentResults.some((it) => it.denied),
    };
  }

  private segmentResult(input: Omit<ShellSegmentPolicyResult, "allowed" | "denied">): ShellSegmentPolicyResult {
    const denied = input.status === PolicyStatus.DENIED || input.flags.some((it) => it.status === PolicyStatus.DENIED);
    return {
      ...input,
      allowed: input.status === PolicyStatus.ALLOWED && input.flags.every((it) => it.status === PolicyStatus.ALLOWED),
      denied,
    };
  }

  private segmentDenyReason(result: ShellSegmentPolicyResult): string {
    const lines = [`Command segment: ${result.rawSegment}`];
    const commandDenied = result.status === PolicyStatus.DENIED;
    if (commandDenied) {
      lines.push(
        result.commandPrefix.length > 0 ? `Matched command scope: '${result.commandPrefix.join(" ")}'` : "Matched command scope: (none)",
        `Decision: ${result.status}`,
        `Lifetime: ${result.lifetime}`,
        `Policy resolution source: ${result.resolutionSource}`,
        `Policy resolution meaning: ${policyResolutionSourceText(result.resolutionSource)}`,
        `Reason: ${result.reason}`,
      );
    }

    const deniedFlags = result.flags.filter((flag) =>
      flag.status === PolicyStatus.DENIED && (!commandDenied || !isUnmatchedShellFlag(flag)),
    );
    for (const flag of deniedFlags) {
      lines.push(
        `Flag: '${flag.flag}'`,
        `Decision: ${isUnmatchedShellFlag(flag) ? "UNKNOWN" : flag.status}`,
        `Lifetime: ${flag.lifetime}`,
        `Policy resolution source: ${isUnmatchedShellFlag(flag) ? PolicyResolutionSource.SYSTEM : result.resolutionSource}`,
        `Policy resolution meaning: ${policyResolutionSourceText(isUnmatchedShellFlag(flag) ? PolicyResolutionSource.SYSTEM : result.resolutionSource)}`,
        `Reason: ${flag.reason}`,
      );
    }
    return lines.join("\n");
  }

  private standardizeDeleteRequest(request: ShellPolicyDeleteRequest): ShellPolicyDeleteRequest {
    return {
      commandArgs: request.commandArgs.map((it) => it.trim()).filter(Boolean),
      removeEntirePolicy: request.removeEntirePolicy,
      flags: request.flags.map((it) => it.trim()).filter(Boolean),
    };
  }

  private standardizePolicy(policy: ShellPolicy): ShellPolicy {
    const flags = Object.fromEntries(
      Object.values(policy.flags)
        .map((it) => ({ ...it, flag: it.flag.trim() }))
        .filter((it) => it.flag.length > 0)
        .map((it) => [it.flag, it]),
    );
    return {
      commandArgs: policy.commandArgs.map((it) => it.trim()).filter(Boolean),
      flags,
      allowAllFlags: policy.allowAllFlags === true,
      lifetime: policy.lifetime,
      status: policy.status,
      reason: policy.reason.trim(),
    };
  }
}

class ShellPolicyTree {
  private readonly policies: ShellPolicy[] = [];

  policiesSnapshot(): ShellPolicy[] {
    return this.policies.map(clonePolicy);
  }

  persistedPolicies(): ShellPolicy[] {
    return this.policies.flatMap((policy) => {
      const persistedFlags = Object.fromEntries(
        Object.values(policy.flags).filter((it) => isPersistedLifetime(it.lifetime)).map((it) => [it.flag, { ...it }]),
      );
      if (isPersistedLifetime(policy.lifetime)) return [{ ...policy, flags: persistedFlags }];
      if (Object.keys(persistedFlags).length > 0) return [{ ...policy, flags: persistedFlags }];
      return [];
    });
  }

  findCommandPolicy(commandArgs: string[]): ShellPolicy | undefined {
    return this.policies
      .filter((policy) => startsWithWords(commandArgs, policy.commandArgs))
      .sort((left, right) => right.commandArgs.length - left.commandArgs.length)[0];
  }

  findExactPolicy(commandArgs: string[]): ShellPolicy | undefined {
    return this.policies.find((policy) => arraysEqual(policy.commandArgs, commandArgs));
  }

  addPolicies(policies: ShellPolicy[]): void {
    for (const policy of policies) {
      const stored = this.findExactPolicy(policy.commandArgs);
      if (!stored) {
        this.policies.push(clonePolicy(policy));
        continue;
      }
      stored.lifetime = policy.lifetime;
      stored.status = policy.status;
      stored.reason = policy.reason;
      stored.allowAllFlags = policy.allowAllFlags;
      for (const incoming of Object.values(policy.flags)) stored.flags[incoming.flag] = { ...incoming };
    }
  }

  removePolicy(request: ShellPolicyDeleteRequest): void {
    if (request.removeEntirePolicy) {
      const index = this.policies.findIndex((policy) => arraysEqual(policy.commandArgs, request.commandArgs));
      if (index >= 0) this.policies.splice(index, 1);
      return;
    }
    const stored = this.findExactPolicy(request.commandArgs);
    if (!stored) return;
    for (const flag of request.flags) delete stored.flags[flag];
  }
}

export function shellPolicyCommandArgsFor(command: string): string[] {
  const parsed = parseShellPolicyCommandScope(command);
  return parsed?.commandArgs ?? [];
}

export function shellPolicyFlagsFor(command: string): string[] {
  const parsed = parseShellPolicyCommandScope(command);
  return parsed?.flags ?? [];
}

function parseShellPolicyCommandScope(command: string): {commandArgs: string[]; flags: string[]} | null {
  const segments = splitShellSegments(command);
  if (segments.length !== 1) return null;
  const segment = segments[0] ?? command;
  const tokens = tokenizeShellSegment(segment);
  if (hasUnsafeShellSyntax(segment, tokens)) return null;
  const commandArgs = commandPrefixFor(tokens);
  if (commandArgs.length === 0) return null;
  return {commandArgs, flags: flagsForTokens(tokens, commandArgs.length)};
}

const splitShellSegments = (input: string): string[] => {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  let skipNext = false;

  const flush = (): void => {
    segments.push(current.trim());
    current = "";
  };

  for (let index = 0; index < input.length; index++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const char = input[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    const next = input[index + 1];
    if (char === ";" || char === "\n" || char === "\r") flush();
    else if (char === "|" && next === "|") {
      flush();
      skipNext = true;
    } else if (char === "|") flush();
    else if (char === "&" && (next === "&" || next === "|")) {
      flush();
      skipNext = true;
    } else if (char === "&") flush();
    else current += char;
  }
  flush();
  return segments;
};

type ShellToken = {
  value: string;
  quoted: boolean;
};

const tokenizeShellSegment = (input: string): ShellToken[] => {
  const tokens: ShellToken[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  let quoted = false;

  const flush = (): void => {
    if (current.length > 0 || quoted) {
      tokens.push({value: current, quoted});
      current = "";
      quoted = false;
    }
  };

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
    } else if (/\s/.test(char)) flush();
    else current += char;
  }
  flush();
  return tokens;
};

const isFlag = (input: string): boolean => /^--?[a-zA-Z0-9]/.test(input);

const hasUnsafeShellSyntax = (rawSegment: string, tokens: ShellToken[]): boolean =>
  hasUnsafeRawShellSyntax(rawSegment) || hasUnsafeBashCommand(tokens);

const hasUnsafeRawShellSyntax = (input: string): boolean => {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote === "'") {
      if (char === quote) quote = null;
      continue;
    }

    if (quote === '"') {
      if (char === quote) quote = null;
      else if (char === "$" || char === "`") return true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if ("$`(){}*?;|&<>".includes(char)) return true;
  }

  return false;
};

const hasUnsafeBashCommand = (tokens: ShellToken[]): boolean => {
  const executable = tokens[0]?.value.split(/[\\/]/).pop()?.toLowerCase();
  if (!executable) return false;
  const args = tokens.slice(1).map((it) => it.value.toLowerCase());

  if (["bash", "sh", "dash", "zsh", "ksh"].includes(executable)) {
    return args.some((it) => it === "-c" || it.startsWith("-c") || (/^-[^-]/.test(it) && it.slice(1).includes("c")));
  }

  if (["eval", "source", ".", "exec"].includes(executable)) return true;

  if (executable === "find") {
    return args.some((it) => ["-exec", "-execdir", "-ok", "-okdir"].includes(it));
  }

  if (executable === "xargs") return true;

  return false;
};

const flagsForTokens = (tokens: ShellToken[], startIndex: number): string[] => {
  const flags: string[] = [];
  for (const token of tokens.slice(startIndex)) {
    if (token.value === "--") break;
    if (!token.quoted && isFlag(token.value)) flags.push(token.value);
  }
  return [...new Set(flags)];
};

const isCommandCoreArgument = (token: ShellToken | undefined): token is ShellToken => {
  if (!token) return false;
  if (token.quoted) return false;
  if (isFlag(token.value)) return false;
  if (token.value === "--") return false;
  if (isPathLikeArgument(token.value)) return false;
  if (isFileLikeArgument(token.value)) return false;
  if (!isSimpleCommandWord(token.value)) return false;
  return true;
};

const isPathLikeArgument = (value: string): boolean =>
  value.includes("/") ||
  value.includes("\\") ||
  value.startsWith("./") ||
  value.startsWith("../") ||
  /^[a-zA-Z]:/.test(value);

const isFileLikeArgument = (value: string): boolean => /(?:^|[^.])\.[a-zA-Z0-9]{1,12}$/.test(value);

const isSimpleCommandWord = (value: string): boolean => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);

const subcommandFirstExecutables = new Set(["docker", "gh", "git", "npm", "pnpm", "yarn"]);

const commandPrefixFor = (tokens: ShellToken[]): string[] => {
  const executable = tokens[0]?.value;
  if (!executable) return [];

  const commandPrefix = [executable];
  const executableName = executable.split(/[\\/]/).pop()?.toLowerCase() ?? executable.toLowerCase();
  const firstArgument = tokens[1];

  if (subcommandFirstExecutables.has(executableName) && isCommandCoreArgument(firstArgument)) {
    commandPrefix.push(firstArgument.value);
  }

  return commandPrefix;
};

const startsWithWords = (words: string[], prefix: string[]): boolean =>
  words.length >= prefix.length && prefix.every((word, index) => words[index] === word);

const arraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const isUnmatchedShellFlag = (flag: ShellFlagPolicyStatus): boolean =>
  flag.reason.startsWith("No matching shell flag policy found.");

const clonePolicy = (policy: ShellPolicy): ShellPolicy => ({
  commandArgs: [...policy.commandArgs],
  flags: Object.fromEntries(Object.entries(policy.flags).map(([flag, status]) => [flag, { ...status }])),
  allowAllFlags: policy.allowAllFlags,
  lifetime: policy.lifetime,
  status: policy.status,
  reason: policy.reason,
});

const describePolicy = (policy: ShellPolicy): string => {
  const command = `${policy.commandArgs.join(" ")}: ${policy.status}, Time: ${policy.lifetime}, All flags: ${policy.allowAllFlags ? "allowed" : "restricted"}, Reason: ${policy.reason || "<none>"}`;
  const flags = Object.values(policy.flags)
    .map((it) => `${it.flag}: ${it.status}, Time: ${it.lifetime}, Reason: ${it.reason || "<none>"}`)
    .join("\n");
  return `${command}\n${flags}`;
};
