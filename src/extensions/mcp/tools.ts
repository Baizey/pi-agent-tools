import crypto from "node:crypto";
import {PiExtensionApi, AgentToolResult, ImageContent, TextContent, ToolDefinition, AgentToolUpdateCallback} from "../../pi/types";
import {FoldDirection, renderToolCallInput, renderToolResultOutput} from "../../shared/toolRendering";
import {errorResult} from "../../shared/toolResults";
import {McpConfigStore, shouldExposeMcpTool} from "./config";
import {McpManager} from "./client";
import {
  McpConfigSnapshot,
  McpServerConfig,
  McpTool,
  McpToolCallResult,
  McpToolDetails,
  McpToolNamePart,
} from "./types";

const mcpToolDescriptionPrefix = "MCP tool";
const maxMcpTextOutputChars = 80_000;

export type McpToolRegistrationResult = {
  registered: Array<{serverName: string; mcpToolName: string; piToolName: string}>;
  skipped: Array<{serverName: string; mcpToolName: string; reason: string}>;
};

export class McpToolRegistry {
  private readonly registeredPiToolNames = new Set<string>();
  private readonly registeredByServerTool = new Map<string, string>();

  constructor(
    private readonly pi: Pick<PiExtensionApi, "registerTool">,
    private readonly manager: McpManager,
    private readonly store: McpConfigStore,
  ) {}

  registerAvailableTools(config: McpConfigSnapshot = this.store.load()): McpToolRegistrationResult {
    const result: McpToolRegistrationResult = {registered: [], skipped: []};
    for (const [serverName, server] of Object.entries(config.servers)) {
      const tools = this.manager.toolsFor(serverName);
      const exposed = tools.filter((tool) => shouldRegisterMcpTool(server, tool.name));
      const toolNames = buildMcpPiToolNames(serverName, exposed.map((tool) => tool.name), this.registeredPiToolNames);
      for (const tool of tools) {
        if (!shouldRegisterMcpTool(server, tool.name)) {
          result.skipped.push({serverName, mcpToolName: tool.name, reason: "not exposed"});
          continue;
        }
        const piToolName = toolNames.get(tool.name);
        if (!piToolName) {
          result.skipped.push({serverName, mcpToolName: tool.name, reason: "name generation failed"});
          continue;
        }
        const key = serverToolKey(serverName, tool.name);
        if (this.registeredByServerTool.has(key)) continue;
        if (!this.pi.registerTool) {
          result.skipped.push({serverName, mcpToolName: tool.name, reason: "registerTool unavailable"});
          continue;
        }
        this.pi.registerTool(createMcpPiTool({serverName, mcpTool: tool, piToolName, manager: this.manager, store: this.store}));
        this.registeredByServerTool.set(key, piToolName);
        this.registeredPiToolNames.add(piToolName);
        result.registered.push({serverName, mcpToolName: tool.name, piToolName});
      }
    }
    return result;
  }

  registeredToolNames(): string[] {
    return [...this.registeredPiToolNames].sort();
  }
}

export function buildMcpPiToolNames(serverName: string, toolNames: string[], existing = new Set<string>()): Map<string, string> {
  const result = new Map<string, string>();
  const reserved = new Set(existing);
  for (const toolName of toolNames) {
    const base = [McpToolNamePart.PREFIX, sanitizeToolNamePart(serverName), sanitizeToolNamePart(toolName)].join("_");
    const candidate = uniqueToolName(base, toolName, reserved);
    reserved.add(candidate);
    result.set(toolName, candidate);
  }
  return result;
}

export function sanitizeToolNamePart(input: string): string {
  const sanitized = input.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  return sanitized || "unnamed";
}

export function formatMcpResultText(result: McpToolCallResult): {content: Array<TextContent | ImageContent>; contentTypes: string[]} {
  const output: Array<TextContent | ImageContent> = [];
  const contentTypes: string[] = [];
  for (const block of Array.isArray(result.content) ? result.content : []) {
    const converted = convertMcpContentBlock(block);
    contentTypes.push(converted.contentType);
    output.push(...converted.content);
  }
  if (output.length === 0 && result.structuredContent) {
    contentTypes.push("structuredContent");
    output.push({type: "text", text: stringifyMcpJson(result.structuredContent)});
  }
  if (output.length === 0 && Object.prototype.hasOwnProperty.call(result, "toolResult")) {
    contentTypes.push("toolResult");
    output.push({type: "text", text: stringifyMcpJson(result.toolResult)});
  }
  if (output.length === 0) {
    contentTypes.push("empty");
    output.push({type: "text", text: "MCP tool returned no content."});
  }
  return {content: truncateMcpTextOutput(output), contentTypes};
}

function createMcpPiTool(input: {
  serverName: string;
  mcpTool: McpTool;
  piToolName: string;
  manager: McpManager;
  store: McpConfigStore;
}): ToolDefinition {
  const description = [
    `${mcpToolDescriptionPrefix} '${input.mcpTool.name}' from server '${input.serverName}'.`,
    input.mcpTool.description ?? "No MCP tool description provided.",
  ].join(" ");

  return {
    name: input.piToolName,
    label: input.piToolName,
    description,
    promptSnippet: description,
    parameters: normalizeMcpInputSchema(input.mcpTool.inputSchema),
    async execute(_toolCallId, params, signal, onUpdate) {
      const latestConfig = input.store.load();
      const server = latestConfig.servers[input.serverName];
      if (!server) return errorResult(`MCP server is no longer configured: ${input.serverName}`) as AgentToolResult<McpToolDetails>;
      if (!shouldRegisterMcpTool(server, input.mcpTool.name)) {
        return errorResult(`MCP tool is not exposed: ${input.serverName}/${input.mcpTool.name}`) as AgentToolResult<McpToolDetails>;
      }
      const result = await input.manager.callTool(
        input.serverName,
        input.mcpTool.name,
        params as Record<string, unknown>,
        {
          signal,
          onprogress: progressUpdater(onUpdate, input.serverName, input.mcpTool.name, input.piToolName),
        },
      );
      const converted = formatMcpResultText(result);
      const details: McpToolDetails = {
        server: input.serverName,
        tool: input.mcpTool.name,
        piTool: input.piToolName,
        contentTypes: converted.contentTypes,
        ...(result.structuredContent ? {structuredContent: result.structuredContent} : {}),
      };
      return {
        content: converted.content,
        details,
        ...(result.isError ? {isError: true} : {}),
      };
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(input.piToolName, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  };
}

function shouldRegisterMcpTool(server: McpServerConfig, toolName: string): boolean {
  return server.enabled && shouldExposeMcpTool(server, toolName);
}

function normalizeMcpInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") return schema;
  return {type: "object", additionalProperties: true, properties: {}};
}

function progressUpdater(
  onUpdate: AgentToolUpdateCallback<McpToolDetails> | undefined,
  serverName: string,
  toolName: string,
  piToolName: string,
): ((progress: {progress: number; total?: number; message?: string}) => void) | undefined {
  if (!onUpdate) return undefined;
  return (progress) => {
    const total = progress.total !== undefined ? `/${progress.total}` : "";
    const message = progress.message ? ` ${progress.message}` : "";
    onUpdate({
      content: [{type: "text", text: `MCP progress ${serverName}/${toolName}: ${progress.progress}${total}${message}`}],
      details: {server: serverName, tool: toolName, piTool: piToolName, contentTypes: ["progress"]},
    });
  };
}

function convertMcpContentBlock(block: unknown): {content: Array<TextContent | ImageContent>; contentType: string} {
  if (!isRecord(block)) return {content: [{type: "text", text: String(block)}], contentType: "unknown"};
  switch (block.type) {
    case "text":
      return {content: [{type: "text", text: typeof block.text === "string" ? block.text : ""}], contentType: "text"};
    case "image":
      if (typeof block.data === "string" && typeof block.mimeType === "string") {
        return {content: [{type: "image", data: block.data, mimeType: block.mimeType}], contentType: "image"};
      }
      return {content: [{type: "text", text: `[MCP image content omitted: invalid image payload]`}], contentType: "image"};
    case "audio":
      return {content: [{type: "text", text: `[MCP audio content omitted: ${typeof block.mimeType === "string" ? block.mimeType : "unknown type"}]`}], contentType: "audio"};
    case "resource":
      return {content: [{type: "text", text: formatMcpResource(block.resource)}], contentType: "resource"};
    case "resource_link":
      return {content: [{type: "text", text: formatMcpResourceLink(block)}], contentType: "resource_link"};
    default:
      return {content: [{type: "text", text: stringifyMcpJson(block)}], contentType: typeof block.type === "string" ? block.type : "unknown"};
  }
}

function stringifyMcpJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatMcpResource(resource: unknown): string {
  if (!isRecord(resource)) return "[MCP resource content omitted: invalid resource payload]";
  const uri = typeof resource.uri === "string" ? resource.uri : "unknown URI";
  if (typeof resource.text === "string") return `[MCP resource: ${uri}]\n${resource.text}`;
  if (typeof resource.blob === "string") return `[MCP binary resource: ${uri}, ${resource.blob.length} base64 chars]`;
  return `[MCP resource: ${uri}]`;
}

function formatMcpResourceLink(block: Record<string, unknown>): string {
  const name = typeof block.name === "string" ? block.name : "resource";
  const uri = typeof block.uri === "string" ? block.uri : "unknown URI";
  const description = typeof block.description === "string" ? ` - ${block.description}` : "";
  return `[MCP resource link: ${name} ${uri}${description}]`;
}

function truncateMcpTextOutput(content: Array<TextContent | ImageContent>): Array<TextContent | ImageContent> {
  let remaining = maxMcpTextOutputChars;
  const output: Array<TextContent | ImageContent> = [];
  for (const item of content) {
    if (item.type !== "text") {
      output.push(item);
      continue;
    }
    if (remaining <= 0) continue;
    const truncated = item.text.slice(0, remaining);
    remaining -= truncated.length;
    output.push({...item, text: truncated + (item.text.length > truncated.length ? "\n[Truncated MCP text output]" : "")});
  }
  return output;
}

function uniqueToolName(base: string, originalToolName: string, reserved: Set<string>): string {
  if (!reserved.has(base)) return base;
  const hash = crypto.createHash("sha1").update(originalToolName).digest("hex").slice(0, 8);
  const withHash = `${base}_${hash}`;
  if (!reserved.has(withHash)) return withHash;
  let index = 2;
  while (reserved.has(`${withHash}_${index}`)) index++;
  return `${withHash}_${index}`;
}

function serverToolKey(serverName: string, toolName: string): string {
  return `${serverName}\u0000${toolName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
