import {
  CodeExecMode,
  CodeExecPolicy,
  CodeExecPolicyDeleteRequest,
  CodeExecPolicyResult,
  CodeExecPolicyScopeOption,
  isPersistedLifetime,
  PolicyLifetime,
  PolicyResolutionSource,
  policyResolutionSourceText,
  PolicyStatus,
  PolicyWildcard,
} from "../types";

export type CodeExecPolicyLogicOptions = {
  policies?: CodeExecPolicy[];
};

export class CodeExecPolicyLogic {
  static createPolicy(
    language: string,
    mode: CodeExecMode | PolicyWildcard.ALL,
    status: PolicyStatus,
    lifetime: PolicyLifetime,
    reason: string,
  ): CodeExecPolicy {
    return {language: normalizeLanguage(language), mode, lifetime, status, reason};
  }

  private readonly policies: CodeExecPolicy[] = [];

  constructor(options: CodeExecPolicyLogicOptions = {}) {
    if (options.policies) this.addPolicies(options.policies);
  }

  evaluate(language: string, mode: CodeExecMode, denyByDefault = false): CodeExecPolicyResult | null {
    const normalizedLanguage = normalizeLanguage(language);
    const policy = this.findPolicy(normalizedLanguage, mode);

    if (!policy) {
      if (!denyByDefault) return null;
      return {
        language: normalizedLanguage,
        mode,
        matchedLanguage: PolicyWildcard.ALL,
        matchedMode: PolicyWildcard.ALL,
        matchedScope: "(none)",
        matchedLifetime: PolicyLifetime.FOREVER,
        matchedStatus: PolicyStatus.DENIED,
        matchedReason: "No matching code execution policy found. denied by default, you cannot execute this.",
        resolutionSource: PolicyResolutionSource.SYSTEM,
      };
    }

    return {
      language: normalizedLanguage,
      mode,
      matchedLanguage: policy.language,
      matchedMode: policy.mode,
      matchedScope: scopeLabel(policy.language, policy.mode),
      matchedLifetime: policy.lifetime,
      matchedStatus: policy.status,
      matchedReason: policy.reason,
      resolutionSource: PolicyResolutionSource.EXISTING_USER_POLICY,
    };
  }

  pendingPolicyScopeOptions(language: string, mode: CodeExecMode): CodeExecPolicyScopeOption[] {
    const normalizedLanguage = normalizeLanguage(language);
    const options: CodeExecPolicyScopeOption[] = [
      {label: scopeLabel(normalizedLanguage, mode), language: normalizedLanguage, mode},
      {label: scopeLabel(normalizedLanguage, PolicyWildcard.ALL), language: normalizedLanguage, mode: PolicyWildcard.ALL},
      {label: scopeLabel(PolicyWildcard.ALL, mode), language: PolicyWildcard.ALL, mode},
      {label: scopeLabel(PolicyWildcard.ALL, PolicyWildcard.ALL), language: PolicyWildcard.ALL, mode: PolicyWildcard.ALL},
    ];
    return options.filter((option) => !this.findExactPolicy(option.language, option.mode));
  }

  createPolicyForScope(
    scope: CodeExecPolicyScopeOption,
    status: PolicyStatus,
    lifetime: PolicyLifetime,
    reason: string,
  ): CodeExecPolicy {
    return CodeExecPolicyLogic.createPolicy(scope.language, scope.mode, status, lifetime, reason);
  }

  addPolicies(policies: CodeExecPolicy[]): void {
    for (const rawPolicy of policies) {
      const policy = this.standardizePolicy(rawPolicy);
      const stored = this.findExactPolicy(policy.language, policy.mode);
      if (!stored) {
        this.policies.push(policy);
        continue;
      }
      stored.lifetime = policy.lifetime;
      stored.status = policy.status;
      stored.reason = policy.reason;
    }
  }

  removePolicies(requests: CodeExecPolicyDeleteRequest[]): void {
    for (const rawRequest of requests) {
      const request = this.standardizeDeleteRequest(rawRequest);
      const index = this.policies.findIndex((policy) => policy.language === request.language && policy.mode === request.mode);
      if (index >= 0) this.policies.splice(index, 1);
    }
  }

  policiesSnapshot(): CodeExecPolicy[] {
    return this.policies.map((policy) => ({...policy}));
  }

  persistedPolicies(): CodeExecPolicy[] {
    return this.policies.filter((policy) => isPersistedLifetime(policy.lifetime)).map((policy) => ({...policy}));
  }

  toDenyReasonOrNull(result: CodeExecPolicyResult): string | null {
    if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
    return [
      "CODE EXECUTION DENIED",
      `Language: ${result.language}`,
      `Mode: ${result.mode}`,
      `Policy lifetime: ${result.matchedLifetime}`,
      `Policy scope: '${result.matchedScope}'`,
      `Policy resolution source: ${result.resolutionSource}`,
      `Policy resolution meaning: ${policyResolutionSourceText(result.resolutionSource)}`,
      `Policy reason: ${result.matchedReason}`,
    ].join("\n");
  }

  private findPolicy(language: string, mode: CodeExecMode): CodeExecPolicy | undefined {
    return this.policies
      .filter((policy) => matches(policy, language, mode))
      .sort((left, right) => specificity(right) - specificity(left))[0];
  }

  private findExactPolicy(language: string, mode: CodeExecMode | PolicyWildcard.ALL): CodeExecPolicy | undefined {
    return this.policies.find((policy) => policy.language === language && policy.mode === mode);
  }

  private standardizePolicy(policy: CodeExecPolicy): CodeExecPolicy {
    return {
      language: normalizeLanguage(policy.language),
      mode: policy.mode === CodeExecMode.FILE || policy.mode === CodeExecMode.INLINE
        ? policy.mode
        : PolicyWildcard.ALL,
      lifetime: policy.lifetime,
      status: policy.status,
      reason: policy.reason.trim(),
    };
  }

  private standardizeDeleteRequest(request: CodeExecPolicyDeleteRequest): CodeExecPolicyDeleteRequest {
    return {
      language: normalizeLanguage(request.language),
      mode: request.mode === CodeExecMode.FILE || request.mode === CodeExecMode.INLINE
        ? request.mode
        : PolicyWildcard.ALL,
    };
  }
}

function normalizeLanguage(language: string): string {
  const trimmed = language.trim().toLowerCase();
  return trimmed === "" ? PolicyWildcard.ALL : trimmed;
}

function matches(policy: CodeExecPolicy, language: string, mode: CodeExecMode): boolean {
  return (policy.language === PolicyWildcard.ALL || policy.language === language) && (policy.mode === PolicyWildcard.ALL || policy.mode === mode);
}

function specificity(policy: CodeExecPolicy): number {
  return (policy.language === PolicyWildcard.ALL ? 0 : 2) + (policy.mode === PolicyWildcard.ALL ? 0 : 1);
}

function scopeLabel(language: string, mode: CodeExecMode | PolicyWildcard.ALL): string {
  return `${language} ${mode}`;
}
