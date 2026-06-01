import {
  isPersistedLifetime,
  PolicyLifetime,
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
  ): ShellPolicy {
    const normalizedCommandArgs = Array.isArray(commandArgs) ? commandArgs : tokenizeShellSegment(commandArgs);
    return {
      commandArgs: normalizedCommandArgs,
      flags: Object.fromEntries(flags.map((flag) => [flag.flag, { ...flag }])),
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
    const segments = splitShellSegments(command);
    const segmentResults = segments.length === 0
      ? [this.evaluateSegment(command, denyByDefault)]
      : segments.map((segment) => this.evaluateSegment(segment, denyByDefault));

    if (segmentResults.some((it) => it === null)) return null;
    return this.result(command, segmentResults as ShellSegmentPolicyResult[]);
  }

  policyScopeOptions(command: string): ShellPolicyScopeOption[] {
    const options = new Map<string, ShellPolicyScopeOption>();
    const segments = splitShellSegments(command);
    for (const segment of segments.length === 0 ? [command] : segments) {
      const tokens = tokenizeShellSegment(segment);
      const commandPrefix = takeWhile(tokens, (token) => !isFlag(token));
      if (commandPrefix.length === 0 || hasUnsafeShellSyntax(segment, tokens)) continue;

      const flags = tokens.slice(commandPrefix.length).filter(isFlag);
      for (let size = commandPrefix.length; size >= 1; size--) {
        const scopedCommand = commandPrefix.slice(0, size);
        const key = scopedCommand.join("\0");
        if (!options.has(key)) {
          options.set(key, {
            label: scopedCommand.join(" "),
            commandArgs: scopedCommand,
            flags: size === commandPrefix.length ? [...new Set(flags)] : [],
          });
        }
      }
    }
    return [...options.values()];
  }

  addPolicies(policies: ShellPolicy[]): void {
    this.policies.addPolicies(policies.map((policy) => this.standardizePolicy(policy)));
  }

  removePolicies(policies: ShellPolicyDeleteRequest[]): void {
    for (const policy of policies) this.policies.removePolicy(this.standardizeDeleteRequest(policy));
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
      "The following commands were denied:",
      ...result.segmentResults.filter((it) => it.denied).map((it) => this.segmentDenyReason(it)),
    ].join("\n");
  }

  private evaluateSegment(rawSegment: string, denyByDefault: boolean): ShellSegmentPolicyResult | null {
    return this.evaluateTokens(rawSegment, tokenizeShellSegment(rawSegment), denyByDefault);
  }

  private evaluateTokens(rawSegment: string, tokens: string[], denyByDefault: boolean): ShellSegmentPolicyResult | null {
    const commandPrefix = takeWhile(tokens, (token) => !isFlag(token));
    if (commandPrefix.length === 0) {
      return this.deniedSegment(rawSegment, commandPrefix, [], denyByDefault, "No command found in shell segment.");
    }

    const flagTokens = tokens.slice(commandPrefix.length).filter(isFlag);
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
    const resolvedFlagResults = flagTokens.map(
      (flag) => exactFlagPolicy?.flags[flag] ? { ...exactFlagPolicy.flags[flag] } : this.defaultFlagStatus(flag, denyByDefault),
    );

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

    if (commandPolicy.status !== PolicyStatus.DENIED && !denyByDefault && resolvedFlagResults.some((flag) => flag.status === PolicyStatus.DENIED && !exactFlagPolicy?.flags[flag.flag])) {
      return null;
    }

    return this.segmentResult({
      rawSegment,
      commandPrefix,
      flags: resolvedFlagResults,
      lifetime: commandPolicy.lifetime,
      status: commandPolicy.status,
      reason: commandPolicy.reason,
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

  private result(command: string, segmentResults: ShellSegmentPolicyResult[]): ShellPolicyResult {
    return {
      command,
      segmentResults,
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
    const lines = [`Evaluated raw command: ${result.rawSegment}`];
    if (result.status === PolicyStatus.DENIED) {
      lines.push(
        `Evaluated segment: '${result.commandPrefix.join(" ")}'`,
        `Policy status: ${result.status}`,
        `Policy lifetime: ${result.lifetime}`,
        `Policy reason: ${result.reason}`,
      );
    }
    for (const flag of result.flags.filter((it) => it.status === PolicyStatus.DENIED)) {
      lines.push(
        `Evaluated flag: '${flag.flag}'`,
        `Policy status: ${flag.status}`,
        `Policy lifetime: ${flag.lifetime}`,
        `Policy reason: ${flag.reason}`,
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
      lifetime: policy.lifetime,
      status: policy.status,
      reason: policy.reason.trim(),
    };
  }
}

export class ShellPolicyTree {
  private readonly policies: ShellPolicy[] = [];

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

const splitShellSegments = (input: string): string[] => {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  let skipNext = false;

  const flush = (): void => {
    const segment = current.trim();
    if (segment.length > 0) segments.push(segment);
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
    if (char === ";" || char === "|" || char === "\n" || char === "\r") flush();
    else if (char === "&" && (next === "&" || next === "|")) {
      flush();
      skipNext = true;
    } else if (char === "&") flush();
    else current += char;
  }
  flush();
  return segments;
};

const tokenizeShellSegment = (input: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;

  const flush = (): void => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
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
    if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) flush();
    else current += char;
  }
  flush();
  return tokens;
};

const isFlag = (input: string): boolean => input.startsWith("-") && input !== "-";

const hasUnsafeShellSyntax = (rawSegment: string, tokens: string[]): boolean =>
  rawSegment.includes("$") ||
  rawSegment.includes("`") ||
  rawSegment.includes("(") ||
  rawSegment.includes(")") ||
  rawSegment.includes("{") ||
  rawSegment.includes("}") ||
  rawSegment.includes("*") ||
  rawSegment.includes("?") ||
  tokens.some(isRedirectionOperator) ||
  tokens.some(hasShellControlOperator) ||
  hasUnsafeBashCommand(tokens);

const isRedirectionOperator = (input: string): boolean => {
  const trimmed = input.trim();
  if ([">", ">>", "<", "<<", ">&", "<&", "&>", "&>>"].includes(trimmed)) return true;
  return /.*\d*(>>?|<<?|>&|<&).*/.test(trimmed);
};

const hasShellControlOperator = (input: string): boolean => /[;|&]/.test(input);

const hasUnsafeBashCommand = (tokens: string[]): boolean => {
  const executable = tokens[0]?.split(/[\\/]/).pop()?.toLowerCase();
  if (!executable) return false;
  const args = tokens.slice(1).map((it) => it.toLowerCase());

  if (["bash", "sh", "dash", "zsh", "ksh"].includes(executable)) {
    return args.some((it) => it === "-c" || it.startsWith("-c"));
  }

  if (["eval", "source", ".", "exec"].includes(executable)) return true;

  if (executable === "find") {
    return args.some((it) => ["-exec", "-execdir", "-ok", "-okdir"].includes(it));
  }

  if (executable === "xargs") return true;

  return false;
};

const takeWhile = <T>(items: T[], predicate: (item: T) => boolean): T[] => {
  const result: T[] = [];
  for (const item of items) {
    if (!predicate(item)) break;
    result.push(item);
  }
  return result;
};

const startsWithWords = (words: string[], prefix: string[]): boolean =>
  words.length >= prefix.length && prefix.every((word, index) => words[index] === word);

const arraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const clonePolicy = (policy: ShellPolicy): ShellPolicy => ({
  commandArgs: [...policy.commandArgs],
  flags: Object.fromEntries(Object.entries(policy.flags).map(([flag, status]) => [flag, { ...status }])),
  lifetime: policy.lifetime,
  status: policy.status,
  reason: policy.reason,
});

const describePolicy = (policy: ShellPolicy): string => {
  const command = `${policy.commandArgs.join(" ")}: ${policy.status}, Time: ${policy.lifetime}, Reason: ${policy.reason || "<none>"}`;
  const flags = Object.values(policy.flags)
    .map((it) => `${it.flag}: ${it.status}, Time: ${it.lifetime}, Reason: ${it.reason || "<none>"}`)
    .join("\n");
  return `${command}\n${flags}`;
};
