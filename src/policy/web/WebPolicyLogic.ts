import {isPersistedLifetime, PolicyLifetime, PolicyResolutionSource, policyResolutionSourceText, PolicyStatus, WebAccessType, WebPolicy, WebPolicyDeleteRequest, WebPolicyResult, WebPolicyScopeOption} from "../types";

export class WebPolicyLogic {
  private readonly policies: WebPolicy[] = [];

  constructor(options: {policies?: WebPolicy[]} = {}) {
    if (options.policies) this.addPolicies(options.policies);
  }

  static createPolicy(host: string, path: string, accessType: WebAccessType, lifetime: PolicyLifetime, status: PolicyStatus, reason: string): WebPolicy {
    return {host: normalizeHost(host), path: normalizePath(path), accessType, lifetime, status, reason};
  }

  evaluate(inputUrl: string, accessType: WebAccessType, denyByDefault = false): WebPolicyResult | null {
    const target = parseUrl(inputUrl);
    if (!target) {
      return {
        url: inputUrl,
        accessType,
        host: "",
        path: "",
        matchedHost: "(invalid)",
        matchedPath: "(invalid)",
        matchedScope: "(invalid)",
        matchedLifetime: PolicyLifetime.ONCE,
        matchedStatus: PolicyStatus.DENIED,
        matchedReason: "Invalid URL. Web policy requires a full http(s) URL.",
        resolutionSource: PolicyResolutionSource.SYSTEM,
      };
    }

    const policy = this.findPolicy(target.host, target.path, accessType);
    if (!policy) {
      if (!denyByDefault) return null;
      return {
        url: target.url,
        accessType,
        host: target.host,
        path: target.path,
        matchedHost: "(none)",
        matchedPath: "(none)",
        matchedScope: "(none)",
        matchedLifetime: PolicyLifetime.FOREVER,
        matchedStatus: PolicyStatus.DENIED,
        matchedReason: "No matching web policy found. denied by default, you cannot access this URL.",
        resolutionSource: PolicyResolutionSource.SYSTEM,
      };
    }

    return {
      url: target.url,
      accessType,
      host: target.host,
      path: target.path,
      matchedHost: policy.host,
      matchedPath: policy.path,
      matchedScope: displayScopeLabel(policy.host, policy.path),
      matchedLifetime: policy.lifetime,
      matchedStatus: policy.status,
      matchedReason: policy.reason,
      resolutionSource: PolicyResolutionSource.EXISTING_USER_POLICY,
    };
  }

  addPolicies(policies: WebPolicy[]): void {
    for (const rawPolicy of policies) {
      const policy = standardizePolicy(rawPolicy);
      const stored = this.policies.find((it) => it.host === policy.host && it.path === policy.path && it.accessType === policy.accessType);
      if (!stored) this.policies.push(policy);
      else Object.assign(stored, policy);
    }
  }

  removePolicies(requests: WebPolicyDeleteRequest[]): void {
    for (const request of requests) {
      const host = normalizeHost(request.host);
      const path = normalizePath(request.path);
      const index = this.policies.findIndex((it) => it.host === host && it.path === path && it.accessType === request.accessType);
      if (index >= 0) this.policies.splice(index, 1);
    }
  }

  policiesSnapshot(): WebPolicy[] {
    return this.policies.map((it) => ({...it}));
  }

  persistedPolicies(): WebPolicy[] {
    return this.policies.filter((it) => isPersistedLifetime(it.lifetime)).map((it) => ({...it}));
  }

  pendingPolicyScopeOptions(inputUrl: string, accessType: WebAccessType): WebPolicyScopeOption[] {
    const target = parseUrl(inputUrl);
    if (!target) return [];
    const pathScopes = scopesForPath(target.path);
    const hostScopes = scopesForHost(target.host);
    const options: WebPolicyScopeOption[] = [];

    for (const path of pathScopes) options.push({label: `${accessType} ${displayScopeLabel(target.host, path)}`, host: target.host, path, accessType});
    for (const host of hostScopes.slice(1)) options.push({label: `${accessType} ${displayScopeLabel(host, "/")}`, host, path: "/", accessType});

    return options;
  }

  createPolicyForScope(scope: WebPolicyScopeOption, lifetime: PolicyLifetime, status: PolicyStatus, reason: string): WebPolicy {
    return WebPolicyLogic.createPolicy(scope.host, scope.path, scope.accessType, lifetime, status, reason);
  }

  toDenyReasonOrNull(result: WebPolicyResult): string | null {
    if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
    return [
      "WEB ACCESS DENIED",
      `URL: '${result.url}'`,
      `Access type: ${result.accessType}`,
      `Policy lifetime: ${result.matchedLifetime}`,
      `Policy scope: '${result.matchedScope}'`,
      `Policy resolution source: ${result.resolutionSource}`,
      `Policy resolution meaning: ${policyResolutionSourceText(result.resolutionSource)}`,
      `Policy reason: ${result.matchedReason}`,
    ].join("\n");
  }

  private findPolicy(host: string, path: string, accessType: WebAccessType): WebPolicy | undefined {
    return this.policies
      .filter((policy) => policy.accessType === accessType && hostMatches(host, policy.host) && pathMatches(path, policy.path))
      .sort((left, right) => specificity(right) - specificity(left))[0];
  }
}

export function parseWebPolicyUrl(inputUrl: string): {url: string; host: string; path: string} | null {
  return parseUrl(inputUrl);
}

export function webPolicyPathForUrl(inputUrl: string): string | null {
  const target = parseUrl(inputUrl);
  return target ? internalScopeLabel(target.host, target.path) : null;
}

function parseUrl(inputUrl: string): {url: string; host: string; path: string} | null {
  try {
    const parsed = new URL(inputUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return {url: parsed.toString(), host: normalizeHost(parsed.hostname), path: normalizePath(parsed.pathname)};
  } catch {
    return null;
  }
}

function standardizePolicy(policy: WebPolicy): WebPolicy {
  return {
    host: normalizeHost(policy.host),
    path: normalizePath(policy.path),
    accessType: policy.accessType,
    lifetime: policy.lifetime,
    status: policy.status,
    reason: policy.reason.trim(),
  };
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\.+|\.+$/g, "").replace(/^www\./, "");
}

function normalizePath(path: string): string {
  const value = path.trim() || "/";
  const pathname = value.startsWith("/") ? value : `/${value}`;
  return pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function hostMatches(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.endsWith(`.${parent}`);
}

function pathMatches(candidate: string, parent: string): boolean {
  return candidate === parent || (parent !== "/" && candidate.length > parent.length && candidate.startsWith(parent) && candidate[parent.length] === "/") || parent === "/";
}

function scopesForHost(host: string): string[] {
  const parts = host.split(".").filter(Boolean);
  const scopes: string[] = [];
  const minimumLabels = parts.length === 1 ? 1 : 2;
  for (let index = 0; index <= parts.length - minimumLabels; index++) scopes.push(parts.slice(index).join("."));
  return scopes;
}

function scopesForPath(path: string): string[] {
  const scopes: string[] = [];
  let current = normalizePath(path);
  while (true) {
    scopes.push(current);
    if (current === "/") break;
    current = current.slice(0, current.lastIndexOf("/")) || "/";
  }
  return scopes;
}

function specificity(policy: WebPolicy): number {
  return policy.host.split(".").length * 10_000 + policy.path.length;
}

function internalScopeLabel(host: string, path: string): string {
  const reversedHost = host.split(".").reverse().join("/");
  return `${reversedHost}${path === "/" ? "/" : path}`;
}

function displayScopeLabel(host: string, path: string): string {
  return path === "/" ? host : `${host}${path}`;
}
