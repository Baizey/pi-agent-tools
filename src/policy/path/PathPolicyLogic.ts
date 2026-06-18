import {resolvePhysicalPath} from "../../shared/paths";
import {
  FsAccessType,
  isPersistedLifetime,
  PathPolicy,
  PathPolicyDeleteRequest,
  PathPolicyResult,
  PathPolicyStatus,
  PolicyLifetime,
  PolicyResolutionSource,
  policyResolutionSourceText,
  PolicyStatus,
} from "../types";

export type PathStandardizer = (input: string) => string;

export type PathPolicyLogicOptions = {
  policies?: PathPolicy[];
  standardizePath?: PathStandardizer;
};

export class PathPolicyLogic {
  static createPolicy(
    policyPath: string,
    status: PolicyStatus,
    lifetime: PolicyLifetime,
    reason: string,
  ): PathPolicy {
    return {
      path: policyPath,
      info: {
        [FsAccessType.READ]: PathPolicyLogic.createStatus(FsAccessType.READ, lifetime, status, reason),
        [FsAccessType.WRITE]: PathPolicyLogic.createStatus(FsAccessType.WRITE, lifetime, status, reason),
        [FsAccessType.EXECUTE]: PathPolicyLogic.createStatus(FsAccessType.EXECUTE, lifetime, status, reason),
        [FsAccessType.DELETE]: PathPolicyLogic.createStatus(FsAccessType.DELETE, lifetime, status, reason),
        [FsAccessType.EDIT]: PathPolicyLogic.createStatus(FsAccessType.EDIT, lifetime, status, reason),
      },
    };
  }

  static createStatus(
    accessType: FsAccessType,
    lifetime: PolicyLifetime,
    status: PolicyStatus,
    reason: string,
  ): PathPolicyStatus {
    return { accessType, lifetime, status, reason };
  }

  private readonly policies: PathPolicy[] = [];
  private readonly standardizePath: PathStandardizer;

  constructor(options: PathPolicyLogicOptions = {}) {
    this.standardizePath = options.standardizePath ?? PathPolicyLogic.defaultStandardizePath;
    if (options.policies) this.addPolicies(options.policies);
  }

  evaluate(inputPath: string, accessType: FsAccessType, denyByDefault = false): PathPolicyResult | null {
    const evaluatedPath = this.standardizePath(inputPath);
    const policy = this.findPolicy(evaluatedPath, accessType);

    if (!policy) {
      if (!denyByDefault) return null;
      return {
        evaluatedPath,
        evaluatedAccessType: accessType,
        matchedPattern: "(none)",
        matchedLifetime: denyByDefault ? PolicyLifetime.FOREVER : PolicyLifetime.ONCE,
        matchedStatus: PolicyStatus.DENIED,
        matchedReason: denyByDefault
          ? "No matching policy found. denied by default, you cannot access this"
          : "No matching policy found. Ask for permission if you want to proceed.",
        resolutionSource: PolicyResolutionSource.SYSTEM,
      };
    }

    const status = policy.info[accessType] as PathPolicyStatus;
    return {
      evaluatedPath,
      evaluatedAccessType: accessType,
      matchedPattern: policy.path,
      matchedLifetime: status.lifetime,
      matchedStatus: status.status,
      matchedReason: status.reason,
      resolutionSource: PolicyResolutionSource.EXISTING_USER_POLICY,
    };
  }

  addPolicies(policies: PathPolicy[]): void {
    for (const rawPolicy of policies) {
      const policy = this.standardizePolicy(rawPolicy);
      const stored = this.policies.find((it) => it.path === policy.path);

      if (!stored) {
        this.policies.push(policy);
        continue;
      }

      for (const incoming of Object.values(policy.info)) {
        if (!incoming) continue;
        stored.info[incoming.accessType] = { ...incoming };
      }
    }
  }

  removePolicies(requests: PathPolicyDeleteRequest[]): void {
    for (const rawRequest of requests) {
      const request = this.standardizeDeleteRequest(rawRequest);
      const stored = this.policies.find((it) => it.path === request.path);
      if (!stored) continue;

      for (const accessType of request.accessTypes) delete stored.info[accessType];
      if (Object.keys(stored.info).length === 0) this.policies.splice(this.policies.indexOf(stored), 1);
    }
  }

  policiesSnapshot(): PathPolicy[] {
    return this.policies.map((policy) => {
      const snapshot = {
        path: policy.path,
        info: Object.fromEntries(
          Object.entries(policy.info).map(([accessType, status]) => [accessType, status ? { ...status } : status]),
        ) satisfies PathPolicy["info"],
      } satisfies PathPolicy;
      return snapshot;
    });
  }

  persistedPolicies(): PathPolicy[] {
    return this.policies
      .map((policy) => ({
        path: policy.path,
        info: Object.fromEntries(
          Object.entries(policy.info).filter(([, status]) => status && isPersistedLifetime(status.lifetime)),
        ) as PathPolicy["info"],
      }))
      .filter((policy) => Object.keys(policy.info).length > 0);
  }

  toDenyReasonOrNull(result: PathPolicyResult): string | null {
    if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
    return [
      "ACCESS DENIED",
      `Evaluated path: '${result.evaluatedPath}'`,
      `Evaluated access type: ${result.evaluatedAccessType}`,
      `Policy lifetime: ${result.matchedLifetime}`,
      `Policy path: '${result.matchedPattern}'`,
      `Policy resolution source: ${result.resolutionSource}`,
      `Policy resolution meaning: ${policyResolutionSourceText(result.resolutionSource)}`,
      `Policy reason: ${result.matchedReason}`,
    ].join("\n");
  }

  private findPolicy(evaluatedPath: string, accessType: FsAccessType): PathPolicy | undefined {
    return this.policies
      .filter((policy) => policy.info[accessType] && this.isSameOrChildPath(evaluatedPath, policy.path))
      .sort((left, right) => right.path.localeCompare(left.path))[0];
  }

  private standardizePolicy(policy: PathPolicy): PathPolicy {
    return {
      path: this.standardizePath(policy.path),
      info: Object.fromEntries(
        Object.entries(policy.info).map(([accessType, status]) => [accessType, status ? { ...status } : status]),
      ) as PathPolicy["info"],
    };
  }

  private standardizeDeleteRequest(request: PathPolicyDeleteRequest): PathPolicyDeleteRequest {
    return {
      path: this.standardizePath(request.path),
      accessTypes: [...request.accessTypes],
    };
  }

  private isSameOrChildPath(candidate: string, parent: string): boolean {
    const ignoreCase = PathPolicyLogic.looksLikeWindowsPath(candidate) || PathPolicyLogic.looksLikeWindowsPath(parent);
    const left = ignoreCase ? candidate.toLowerCase() : candidate;
    const right = ignoreCase ? parent.toLowerCase() : parent;

    if (left === right) return true;
    return left.length > right.length && left.startsWith(right) && ["\\", "/"].includes(candidate[parent.length]);
  }

  private static defaultStandardizePath(input: string): string {
    return resolvePhysicalPath(input);
  }

  private static looksLikeWindowsPath(value: string): boolean {
    return value.length >= 2 && value[1] === ":";
  }
}
