import {ExtensionContext} from "../../pi/types";
import {PolicyLifetime, PolicyStatus} from "../../policy/types";

export type PolicyApprovalScope<T> = {
  label: string;
  value: T;
  description?: string;
};

export type PolicyApprovalDecision<T> = {
  scope: PolicyApprovalScope<T>;
  status: PolicyStatus;
  lifetime: PolicyLifetime;
  reason: string;
};

export type PolicyApprovalFailure = {
  deniedReason: string;
};

export type PolicyApprovalContextUpdate = {
  intro?: string;
  context?: string | string[];
  scopeDescriptions?: Map<string, string>;
};

export type PolicyApprovalRequest<T> = {
  policyKind: string;
  target: string;
  scopes: Array<PolicyApprovalScope<T>>;
  /** Short advisory/context shown with the approval prompts, such as a summary. */
  intro?: string;
  /** Full stable context for what is being approved; shown on every approval step. */
  context?: string | string[];
  /** Optional lazy helper shown in scope/status dropdowns, e.g. explain command and flags. */
  contextOptionLabel?: string;
  loadContext?: () => Promise<PolicyApprovalContextUpdate>;
  scopePrompt?: string;
  statusPrompt?: (scope: PolicyApprovalScope<T>) => string;
  lifetimePrompt?: string;
  defaultReason?: (status: PolicyStatus, scope: PolicyApprovalScope<T>) => string;
  denyReasonPrompt?: string;
};

export async function askPolicyApproval<T>(
  ctx: ExtensionContext,
  request: PolicyApprovalRequest<T>,
): Promise<PolicyApprovalDecision<T> | PolicyApprovalFailure> {
  if (!ctx.ui || ctx.hasUI === false) {
    return {deniedReason: `No ${request.policyKind} policy matched '${request.target}' and interactive approval is unavailable.`};
  }

  if (request.scopes.length === 0) {
    return {deniedReason: `No ${request.policyKind} policy scope could be inferred for '${request.target}'.`};
  }

  let intro = request.intro;
  let extraContext = request.context;
  let scopeDescriptions = new Map<string, string>();
  let helperLoaded = false;
  const loadHelperContext = async () => {
    if (helperLoaded || !request.loadContext) return;
    helperLoaded = true;
    const update = await request.loadContext();
    intro = update.intro ?? intro;
    extraContext = mergeContext(extraContext, update.context);
    scopeDescriptions = update.scopeDescriptions ?? scopeDescriptions;
  };
  const helperLabel = request.contextOptionLabel ?? `ⓘ Provide context for this ${request.policyKind} policy decision`;

  let scope: PolicyApprovalScope<T> | undefined;
  while (!scope) {
    const displayScopes = new Map(request.scopes.map((candidate) => [displayScope(candidate, scopeDescriptions), candidate] as const));
    const items = [...displayScopes.keys(), ...(request.loadContext && !helperLoaded ? [helperLabel] : [])];
    const scopeChoice = await ctx.ui.select(
      approvalTitle(
        request.scopePrompt ?? `Select ${request.policyKind} policy scope for ${request.target}`,
        intro,
        contextBlock(request.target, extraContext),
      ),
      items,
    );
    if (!scopeChoice) return {deniedReason: `No ${request.policyKind} policy scope selected.`};
    if (scopeChoice === helperLabel) {
      await loadHelperContext();
      continue;
    }
    scope = displayScopes.get(scopeChoice) ?? request.scopes[0];
  }

  let statusChoice: string | undefined;
  while (!statusChoice) {
    const describedScope = {...scope, description: scopeDescriptions.get(scope.label) ?? scope.description};
    const items = ["Allow", "Deny", ...(request.loadContext && !helperLoaded ? [helperLabel] : [])];
    const choice = await ctx.ui.select(
      approvalTitle(
        request.statusPrompt?.(describedScope) ?? `${request.policyKind} policy for ${describedScope.label}`,
        intro,
        contextBlock(request.target, extraContext),
      ),
      items,
    );
    if (!choice) return {deniedReason: `No ${request.policyKind} policy decision selected.`};
    if (choice === helperLabel) {
      await loadHelperContext();
      continue;
    }
    statusChoice = choice;
  }

  const lifetimeChoice = await ctx.ui.select(
    approvalTitle(request.lifetimePrompt ?? `${capitalize(request.policyKind)} policy lifetime`, undefined, contextBlock(request.target, extraContext)),
    [
      PolicyLifetime.ONCE,
      PolicyLifetime.SESSION,
      PolicyLifetime.FOREVER,
    ],
  );
  if (!lifetimeChoice) return {deniedReason: `No ${request.policyKind} policy lifetime selected.`};

  const status = statusChoice === "Allow" ? PolicyStatus.ALLOWED : PolicyStatus.DENIED;
  const lifetime = lifetimeChoice as PolicyLifetime;
  const defaultReason = request.defaultReason?.(status, scope) ?? `User selected ${status} for ${request.policyKind} policy.`;
  const reason = status === PolicyStatus.DENIED
    ? await askForDenyReason(ctx, request.denyReasonPrompt ?? `Reason for denying this ${request.policyKind} policy (optional)`, defaultReason)
    : defaultReason;

  return {scope, status, lifetime, reason};
}

export function isPolicyApprovalFailure<T>(value: PolicyApprovalDecision<T> | PolicyApprovalFailure): value is PolicyApprovalFailure {
  return "deniedReason" in value;
}

function displayScope<T>(scope: PolicyApprovalScope<T>, descriptions: Map<string, string>): string {
  const description = descriptions.get(scope.label) ?? scope.description;
  return description ? `${scope.label} — ${description}` : scope.label;
}

function approvalTitle(title: string, intro?: string, context?: string): string {
  return [title, intro, context].filter(Boolean).join("\n\n");
}

function contextBlock(target: string, context?: string | string[]): string {
  const values = Array.isArray(context) ? context : context ? [context] : [];
  const lines = [`Approval target: ${target}`, ...values.filter((it) => it.trim() !== "")];
  return [`Full context:`, ...lines].join("\n");
}

function mergeContext(left?: string | string[], right?: string | string[]): string[] | undefined {
  const leftValues = Array.isArray(left) ? left : left ? [left] : [];
  const rightValues = Array.isArray(right) ? right : right ? [right] : [];
  const merged = [...leftValues, ...rightValues].filter((it) => it.trim() !== "");
  return merged.length > 0 ? merged : undefined;
}

async function askForDenyReason(ctx: ExtensionContext, title: string, defaultReason: string): Promise<string> {
  if (!ctx.ui?.input) return defaultReason;
  const reason = await ctx.ui.input(title, defaultReason);
  const trimmed = reason?.trim();
  return trimmed ? trimmed : defaultReason;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}
