import {ExtensionContext, PiExtensionApi} from "../../pi/types";
import {AgentRuntime, AgentServices} from "../../pi/runtime";
import {PolicyLifetime, PolicyStatus, WebAccessType, WebPolicyDeleteRequest, WebPolicyResult} from "../../policy/types";
import {agentEnv, isAgentEnvEnabled} from "../../shared/env";
import {toolNames} from "../../shared/toolNames";
import {renderToolCallInput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";
import {askPolicyApproval, isPolicyApprovalFailure} from "../policy-approval";
import {objectSchema, stringParam, successResult, errorResult, booleanParam} from "../file-tools/common";

const defaultSearchUrl = "https://duckduckgo.com/html/";

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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const runtime = services.runtimeFor(ctx?.cwd ?? process.cwd());
      const query = stringValue(params.query);
      const url = stringValue(params.url);
      try {
        if (query) return await searchWeb(ctx, runtime, query, numberValue(params.maxResults) ?? 5);
        if (url) return await readWeb(ctx, runtime, url, params.raw === true);
        return errorResult("Missing required parameter: provide either query or url.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.webLookup, args, theme as never);
    },
  });
}

async function searchWeb(ctx: ExtensionContext | undefined, runtime: AgentRuntime, query: string, maxResults: number) {
  const searchUrl = `${defaultSearchUrl}?q=${encodeURIComponent(query)}`;
  const denied = await ensureWebAllowed(ctx, runtime, searchUrl, WebAccessType.SEARCH, isAgentEnvEnabled(agentEnv.webDenyByDefault));
  if (denied) return errorResult(denied);

  const html = await fetchText(searchUrl);
  const results = parseDuckDuckGoResults(html).slice(0, Math.max(1, Math.min(maxResults, 20)));
  const text = results.length > 0
    ? results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`).join("\n\n")
    : `No results parsed for query: ${query}`;
  return successResult(text, {query, searchUrl, results});
}

async function readWeb(ctx: ExtensionContext | undefined, runtime: AgentRuntime, url: string, raw: boolean) {
  const denied = await ensureWebAllowed(ctx, runtime, url, WebAccessType.READ, isAgentEnvEnabled(agentEnv.webDenyByDefault));
  if (denied) return errorResult(denied);

  const html = await fetchText(url);
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

  const approval = await askPolicyApproval(ctx, {
    policyKind: "web",
    target: `${accessType} ${url}`,
    scopes: scopeOptions.map((scope) => ({label: scope.label, value: scope})),
    context: [`Access type: ${accessType}`, `URL: ${url}`],
    scopePrompt: `Policy scope for ${accessType} ${url}`,
    statusPrompt: () => `No ${accessType} web policy for ${url}`,
    lifetimePrompt: "Web policy lifetime",
    defaultReason: (status) => `User selected ${status} for web ${accessType}.`,
    denyReasonPrompt: "Reason for denying this web policy (optional)",
  });
  if (isPolicyApprovalFailure(approval)) return failed(`Web access denied: ${approval.deniedReason}`);

  const scope = approval.scope.value;
  const policy = runtime.webPolicy.createPolicyForScope(scope, approval.lifetime, approval.status, approval.reason);
  runtime.webPolicy.addPolicies([policy]);
  if (approval.lifetime === PolicyLifetime.ONCE) oneShotPolicies.push({host: scope.host, path: scope.path, accessType: scope.accessType});
  else if (approval.lifetime === PolicyLifetime.FOREVER) runtime.webPolicyStore.save(runtime.webPolicy);

  return runtime.webPolicy.evaluate(url, accessType, true) ?? failed("Web policy could not be resolved.");
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {headers: {"User-Agent": "pi-agent-tools/0.1 (+https://github.com/Baizey/pi-agent-tools)"}});
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return await response.text();
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
