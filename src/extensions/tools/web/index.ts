import {ExtensionContext, PiExtensionApi} from "../../../pi/types";
import {AgentRuntime, AgentServices} from "../../../pi/runtime";
import {PolicyLifetime, PolicyStatus, WebAccessType, WebPolicyDeleteRequest, WebPolicyResult, WebPolicyScopeOption} from "../../../policy/types";
import {agentEnv, isAgentEnvEnabled} from "../../../shared/env";
import {toolNames} from "../../../shared/toolNames";
import {renderToolCallInput} from "../../../shared/toolRendering";
import {stringValue} from "../../../shared/values";
import {UiDecision, UiDecisionFlowManager} from "../../shared/ui-flow";
import {objectSchema, stringParam, successResult, errorResult, booleanParam} from "../file-tools/common";

const defaultSearchUrl = "https://duckduckgo.com/html/";
const fetchTimeoutMs = 30_000;

export function registerWebLookupTool(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerTool?.({
    name: toolNames.webLookup,
    label: "Web Lookup",
    description: "Minimal policy-aware web tool. Provide query to search the web, or url to fetch and read a page.",
    parameters: objectSchema({
      query: stringParam("Search query. If provided, performs a DuckDuckGo web search."),
      url: stringParam("Full http(s) URL to read."),
      maxResults: {type: "number", description: "Maximum search results. Defaults to 5.", default: 5},
      raw: booleanParam("Return raw-ish HTML text instead of simplified text for URL reads. Defaults to false.", false),
    }, []),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const runtime = services.runtimeFor(ctx?.cwd ?? process.cwd());
      const query = stringValue(params.query);
      const url = stringValue(params.url);
      try {
        if (query && url) return errorResult("Invalid parameters: provide either query or url, not both.");
        if (!query && !url) return errorResult("Missing required parameter: provide either query or url.");
        if (query) return await searchWeb(ctx, runtime, query, numberValue(params.maxResults) ?? 5, signal);
        return await readWeb(ctx, runtime, url!, params.raw === true, signal);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.webLookup, args, theme as never);
    },
  });
}

async function searchWeb(ctx: ExtensionContext | undefined, runtime: AgentRuntime, query: string, maxResults: number, signal?: AbortSignal) {
  const searchUrl = `${defaultSearchUrl}?q=${encodeURIComponent(query)}`;
  const denied = await ensureWebAllowed(ctx, runtime, searchUrl, WebAccessType.SEARCH, isAgentEnvEnabled(agentEnv.webDenyByDefault));
  if (denied) return errorResult(denied);

  const html = await fetchText(searchUrl, signal);
  const results = parseDuckDuckGoResults(html).slice(0, Math.max(1, Math.min(maxResults, 20)));
  const text = results.length > 0
    ? results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`).join("\n\n")
    : `No results parsed for query: ${query}`;
  return successResult(text, {query, searchUrl, results});
}

async function readWeb(ctx: ExtensionContext | undefined, runtime: AgentRuntime, url: string, raw: boolean, signal?: AbortSignal) {
  const denied = await ensureWebAllowed(ctx, runtime, url, WebAccessType.READ, isAgentEnvEnabled(agentEnv.webDenyByDefault));
  if (denied) return errorResult(denied);

  const html = await fetchText(url, signal);
  const text = raw ? html : htmlToText(html);
  return successResult(text.slice(0, 80_000), {url, bytes: html.length, truncated: text.length > 80_000});
}

export async function ensureWebAllowed(
  ctx: ExtensionContext | undefined,
  runtime: AgentRuntime,
  url: string,
  accessType: WebAccessType,
  denyByDefault: boolean,
): Promise<string | null> {
  const oneShotPolicies: WebPolicyDeleteRequest[] = [];
  try {
    let result = runtime.webPolicy.evaluate(url, accessType, denyByDefault);
    if (result === null) result = await askForWebPolicy(ctx, runtime, url, accessType, oneShotPolicies);
    if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
    return runtime.webPolicy.toDenyReasonOrNull(result) ?? "Web access denied.";
  } finally {
    runtime.webPolicy.removePolicies(oneShotPolicies);
  }
}

async function askForWebPolicy(
  ctx: ExtensionContext | undefined,
  runtime: AgentRuntime,
  url: string,
  accessType: WebAccessType,
  oneShotPolicies: WebPolicyDeleteRequest[],
): Promise<WebPolicyResult> {
  const failed = (reason: string): WebPolicyResult => ({
    url,
    accessType,
    host: "",
    path: "",
    matchedHost: "(none)",
    matchedPath: "(none)",
    matchedScope: "(none)",
    matchedLifetime: PolicyLifetime.ONCE,
    matchedStatus: PolicyStatus.DENIED,
    matchedReason: reason,
  });

  if (!ctx?.ui || ctx.hasUI === false) return failed(`No web policy matched '${url}' and interactive approval is unavailable.`);
  const scopeOptions = runtime.webPolicy.pendingPolicyScopeOptions(url, accessType);
  if (scopeOptions.length === 0) return failed(`No web policy scope could be inferred for '${url}'.`);

  const approval = await askWebPolicyWithFlow(ctx, url, accessType, scopeOptions);

  const scope = approval.scope;
  const policy = runtime.webPolicy.createPolicyForScope(scope, approval.lifetime, approval.status, approval.reason);
  runtime.webPolicy.addPolicies([policy]);
  if (approval.lifetime === PolicyLifetime.ONCE) oneShotPolicies.push({host: scope.host, path: scope.path, accessType: scope.accessType});
  else if (approval.lifetime === PolicyLifetime.FOREVER) runtime.webPolicyStore.save(runtime.webPolicy);

  return runtime.webPolicy.evaluate(url, accessType, true) ?? failed("Web policy could not be resolved.");
}

type WebPolicyApproval = {
  scope: WebPolicyScopeOption;
  status: PolicyStatus;
  lifetime: PolicyLifetime;
  reason: string;
};

async function askWebPolicyWithFlow(
  ctx: ExtensionContext,
  url: string,
  accessType: WebAccessType,
  scopes: WebPolicyScopeOption[],
): Promise<WebPolicyApproval> {
  const defaultReason = (status: PolicyStatus) => `User selected ${status} for web ${accessType}.`;
  const onCancelReturn = (state: Partial<WebPolicyApproval>): WebPolicyApproval => ({
    scope: state.scope ?? scopes[0],
    status: PolicyStatus.DENIED,
    lifetime: PolicyLifetime.ONCE,
    reason: `Web access denied: ${webFlowCancelReason(state)}`,
  });

  const scopeDecision = {
    type: "select",
    key: "scope",
    title: `Policy scope for ${accessType} ${url}`,
    showAiHelpOption: false,
    options: scopes.map((scope) => ({
      title: scope.label,
      value: scope,
      next: "status",
    })),
  } satisfies UiDecision<WebPolicyApproval>;

  const statusDecision = {
    type: "select",
    key: "status",
    title: [
      `No ${accessType} web policy for ${url}`,
      `Approval target: ${accessType} ${url}`,
    ].join("\n"),
    showAiHelpOption: false,
    options: [
      {title: "Allow", value: PolicyStatus.ALLOWED, next: "lifetime"},
      {title: "Deny", value: PolicyStatus.DENIED, next: "lifetime"},
    ],
  } satisfies UiDecision<WebPolicyApproval>;

  const lifetimeDecision = {
    type: "select",
    key: "lifetime",
    title: [
      "Web policy lifetime",
      `Approval target: ${accessType} ${url}`,
    ].join("\n"),
    showAiHelpOption: false,
    options: [
      {title: PolicyLifetime.ONCE, value: PolicyLifetime.ONCE, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
      {title: PolicyLifetime.SESSION, value: PolicyLifetime.SESSION, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
      {title: PolicyLifetime.FOREVER, value: PolicyLifetime.FOREVER, next: (state) => state.status === PolicyStatus.DENIED ? "reason" : null},
    ],
  } satisfies UiDecision<WebPolicyApproval>;

  const reasonDecision = {
    type: "input",
    key: "reason",
    title: [
      "Reason for denying this web policy (optional)",
      `Approval target: ${accessType} ${url}`,
    ].join("\n"),
    placeholder: (state) => defaultReason(state.status ?? PolicyStatus.DENIED),
    next: null,
  } satisfies UiDecision<WebPolicyApproval>;

  const approval = await new UiDecisionFlowManager(ctx).runFlow(
    scopeDecision,
    {scope: scopeDecision, status: statusDecision, lifetime: lifetimeDecision, reason: reasonDecision},
    onCancelReturn,
  );

  return {
    ...approval,
    reason: approval.reason || defaultReason(approval.status),
  };
}

function webFlowCancelReason(state: Partial<WebPolicyApproval>): string {
  if (!state.scope) return "No web policy scope selected.";
  if (!state.status) return "No web policy decision selected.";
  if (!state.lifetime) return "No web policy lifetime selected.";
  return "No web policy reason selected.";
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error(`Fetch timed out after ${fetchTimeoutMs}ms.`)), fetchTimeoutMs);
  const combinedSignal = combineAbortSignals(signal, timeout.signal);
  try {
    const response = await fetch(url, {
      headers: {"User-Agent": "pi-agent-tools/0.1 (+https://github.com/Baizey/pi-agent-tools)"},
      signal: combinedSignal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function combineAbortSignals(left: AbortSignal | undefined, right: AbortSignal): AbortSignal {
  if (!left) return right;
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  if (left.aborted) abort(left);
  else if (right.aborted) abort(right);
  else {
    left.addEventListener("abort", () => abort(left), {once: true});
    right.addEventListener("abort", () => abort(right), {once: true});
  }
  return controller.signal;
}

function parseDuckDuckGoResults(html: string): Array<{title: string; url: string; snippet: string}> {
  const blocks = html.split(/<div class="result[\s\S]*?result__body/).slice(1);
  return blocks.map((block) => {
    const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) ?? block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    const rawUrl = decodeHtml(linkMatch?.[1] ?? "");
    return {title: cleanup(linkMatch?.[2] ?? ""), url: unwrapDuckDuckGoUrl(rawUrl), snippet: cleanup(snippetMatch?.[1] ?? "")};
  }).filter((it) => it.title && it.url);
}

function unwrapDuckDuckGoUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") ?? parsed.toString();
  } catch {
    return url;
  }
}

function htmlToText(html: string): string {
  return cleanup(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function cleanup(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
