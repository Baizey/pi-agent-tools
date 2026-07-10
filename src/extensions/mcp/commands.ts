import {AutocompleteItem, PiExtensionApi} from "../../pi/types";
import {McpConfigStore, shouldExposeMcpTool} from "./config";
import {McpConnectionState, McpManager, McpServerRuntimeState} from "./client";
import {McpToolRegistry} from "./tools";
import {
  McpCommandAction,
  mcpCommandActions,
  McpCommandMessageKind,
  McpCommandResult,
  McpCommandTarget,
  McpConfigSnapshot,
  McpServerConfig,
  McpTool,
  McpToolExposureStatus,
  McpToolExposureToken,
} from "./types";

export enum McpCommandName {
  MCP = "mcp",
}

export function registerMcpCommand(pi: PiExtensionApi, input: {store: McpConfigStore; manager: McpManager; registry: McpToolRegistry}): void {
  pi.registerCommand?.(McpCommandName.MCP, {
    description: "Manage MCP servers and persisted MCP tool exposure.",
    getArgumentCompletions(prefix) {
      return mcpCommandCompletions(prefix, input.store.load(), (serverName) => input.manager.toolsFor(serverName).map((tool) => tool.name));
    },
    async handler(args, ctx) {
      const result = await handleMcpCommand(input, args, ctx.signal);
      ctx.ui?.notify?.(result.message, result.kind);
    },
  });
}

export async function handleMcpCommand(
  input: {store: McpConfigStore; manager: McpManager; registry: McpToolRegistry},
  args: string,
  signal?: AbortSignal,
): Promise<McpCommandResult> {
  const tokens = tokenizeMcpCommand(args);
  const action = firstMcpAction(tokens) ?? (tokens.length === 0 ? McpCommandAction.SHOW : null);
  if (!action) return err(`Unknown /${McpCommandName.MCP} action: ${tokens[0] ?? ""}`);
  const rest = tokens.slice(1);

  switch (action) {
    case McpCommandAction.SHOW:
      return showMcp(input, rest);
    case McpCommandAction.CONNECT:
      return await connectMcp(input, rest, signal);
    case McpCommandAction.DISCONNECT:
      return await disconnectMcp(input, rest);
    case McpCommandAction.REFRESH:
      return await refreshMcp(input, rest, signal);
    case McpCommandAction.EXPOSE:
      return exposeOrHideMcp(input, rest, "expose");
    case McpCommandAction.HIDE:
      return exposeOrHideMcp(input, rest, "hide");
    case McpCommandAction.RESET:
      return resetMcpExposure(input, rest);
  }
}

export type McpToolCompletionProvider = (serverName: string) => string[];

export function mcpCommandCompletions(prefix: string, config: McpConfigSnapshot, toolNamesForServer: McpToolCompletionProvider = () => []): AutocompleteItem[] {
  const tokens = tokenizeMcpCommand(prefix);
  const current = prefix.endsWith(" ") ? "" : tokens[tokens.length - 1] ?? "";
  const base = prefix.slice(0, prefix.length - current.length);
  if (tokens.length <= 1 && !prefix.endsWith(" ")) return completionValues(mcpCommandActions, current, base);

  const action = firstMcpAction(tokens);
  const serverNames = Object.keys(config.servers);
  if (!action) return completionValues([McpCommandTarget.ALL, ...serverNames], current, base);

  if (actionUsesToolOperands(action)) {
    if (tokens.length <= 1 || (tokens.length === 2 && !prefix.endsWith(" "))) return completionValues(serverNames, current, base);
    const serverName = tokens[1];
    const server = config.servers[serverName];
    if (!server) return [];
    const values = [McpToolExposureToken.ALL, ...toolNamesForServer(serverName), ...(server.tools.expose ?? []), ...(server.tools.hide ?? [])];
    return completionValues(uniqueCompletionValues(values), current, base);
  }

  if (tokens.length <= 1 || (tokens.length === 2 && !prefix.endsWith(" "))) return completionValues([McpCommandTarget.ALL, ...serverNames], current, base);
  return [];
}

function exposeOrHideMcp(
  input: {store: McpConfigStore; manager: McpManager; registry: McpToolRegistry},
  tokens: string[],
  mode: "expose" | "hide",
): McpCommandResult {
  const [serverName, ...tools] = tokens;
  if (!serverName) return err(`Missing MCP server name for ${mode}.`);
  if (tools.length === 0) return err(`Missing MCP tool name for ${mode}.`);
  const config = input.store.load();
  if (!config.servers[serverName]) return err(`Unknown MCP server: ${serverName}`);
  const nextConfig = input.store.setToolExposure(serverName, mode, tools);
  input.manager.updateConfig(nextConfig);
  const registration = input.registry.registerAvailableTools(nextConfig);
  return ok([
    `MCP ${mode} updated for ${serverName}: ${tools.join(", ")}`,
    registration.registered.length > 0 ? `Registered tools: ${registration.registered.map((tool) => tool.piToolName).join(", ")}` : undefined,
    mode === "hide" ? "Already registered hidden tools remain visible until /reload, but calls are blocked immediately." : undefined,
    "",
    formatMcpStatus(nextConfig, input.manager, serverName),
  ].filter((line): line is string => line !== undefined).join("\n"));
}

function resetMcpExposure(input: {store: McpConfigStore; manager: McpManager}, tokens: string[]): McpCommandResult {
  const [serverName, ...tools] = tokens;
  if (!serverName) return err("Missing MCP server name for reset.");
  const config = input.store.load();
  if (!config.servers[serverName]) return err(`Unknown MCP server: ${serverName}`);
  const nextConfig = input.store.resetToolExposure(serverName, tools.length > 0 ? tools : undefined);
  input.manager.updateConfig(nextConfig);
  return ok([
    tools.length > 0 ? `MCP exposure reset for ${serverName}: ${tools.join(", ")}` : `MCP exposure reset for ${serverName}.`,
    "",
    formatMcpStatus(nextConfig, input.manager, serverName),
  ].join("\n"));
}

function showMcp(input: {store: McpConfigStore; manager: McpManager}, tokens: string[]): McpCommandResult {
  const config = input.store.load();
  input.manager.updateConfig(config);
  const target = tokens[0];
  if (!target || target === McpCommandTarget.ALL) return ok(formatMcpStatus(config, input.manager));
  if (!config.servers[target]) return err(`Unknown MCP server: ${target}`);
  return ok(formatMcpStatus(config, input.manager, target));
}

async function connectMcp(
  input: {store: McpConfigStore; manager: McpManager; registry: McpToolRegistry},
  tokens: string[],
  signal?: AbortSignal,
): Promise<McpCommandResult> {
  const config = input.store.load();
  input.manager.updateConfig(config);
  const targets = resolveServerTargets(config, tokens[0]);
  if ("error" in targets) return err(targets.error);
  if (targets.serverNames.length === 0) return ok("No MCP servers configured.");
  const lines: string[] = [];
  for (const serverName of targets.serverNames) {
    try {
      const tools = await input.manager.connect(serverName, signal);
      const registration = input.registry.registerAvailableTools(input.store.load());
      lines.push(`Connected ${serverName} (${tools.length} tools, ${registration.registered.filter((tool) => tool.serverName === serverName).length} newly registered).`);
    } catch (error) {
      lines.push(`Failed ${serverName}: ${errorMessage(error)}`);
    }
  }
  return ok(lines.join("\n"));
}

async function disconnectMcp(input: {store: McpConfigStore; manager: McpManager}, tokens: string[]): Promise<McpCommandResult> {
  const config = input.store.load();
  input.manager.updateConfig(config);
  const targets = resolveServerTargets(config, tokens[0]);
  if ("error" in targets) return err(targets.error);
  if (targets.serverNames.length === 0) return ok("No MCP servers configured.");
  await Promise.all(targets.serverNames.map((serverName) => input.manager.disconnect(serverName).catch(() => undefined)));
  return ok(`Disconnected MCP server${targets.serverNames.length === 1 ? "" : "s"}: ${targets.serverNames.join(", ")}`);
}

async function refreshMcp(
  input: {store: McpConfigStore; manager: McpManager; registry: McpToolRegistry},
  tokens: string[],
  signal?: AbortSignal,
): Promise<McpCommandResult> {
  const config = input.store.load();
  input.manager.updateConfig(config);
  const targets = resolveServerTargets(config, tokens[0]);
  if ("error" in targets) return err(targets.error);
  if (targets.serverNames.length === 0) return ok("No MCP servers configured.");
  const lines: string[] = [];
  for (const serverName of targets.serverNames) {
    try {
      const tools = await input.manager.refresh(serverName, signal);
      const registration = input.registry.registerAvailableTools(config);
      lines.push(`Refreshed ${serverName} (${tools.length} tools, ${registration.registered.filter((tool) => tool.serverName === serverName).length} newly registered).`);
    } catch (error) {
      lines.push(`Failed ${serverName}: ${errorMessage(error)}`);
    }
  }
  return ok(lines.join("\n"));
}

function formatMcpStatus(config: McpConfigSnapshot, manager: McpManager, onlyServer?: string): string {
  const serverEntries = Object.entries(config.servers).filter(([serverName]) => !onlyServer || serverName === onlyServer);
  if (serverEntries.length === 0) return onlyServer ? `MCP server not found: ${onlyServer}` : "MCP servers\n  none";
  const stateByServer = new Map(manager.snapshot().states.map((state) => [state.serverName, state]));
  return [
    onlyServer ? `MCP server ${onlyServer}` : "MCP servers",
    ...serverEntries.flatMap(([serverName, server]) => formatMcpServerStatus(serverName, server, manager.toolsFor(serverName), stateByServer.get(serverName))),
  ].join("\n");
}

function formatMcpServerStatus(serverName: string, server: McpServerConfig, tools: McpTool[], state: McpServerRuntimeState = {serverName, state: McpConnectionState.DISCONNECTED, toolCount: 0}): string[] {
  const expose = formatExposureList(server.tools.expose, "none");
  const hide = formatExposureList(server.tools.hide, "none");
  return [
    `  ${serverName}`,
    `    transport ${server.transport}`,
    `    enabled ${server.enabled ? "yes" : "no"}`,
    `    state ${state.state}${state.toolCount > 0 ? ` (${state.toolCount} tools)` : ""}`,
    ...(state.error ? [`    error ${state.error}`] : []),
    `    expose ${expose}`,
    `    hide ${hide}`,
    "    tools",
    ...formatMcpToolStatuses(server, tools),
  ];
}

function formatExposureList(values: string[] | undefined, emptyLabel: string): string {
  if (!values || values.length === 0) return emptyLabel;
  if (values.includes(McpToolExposureToken.ALL)) return ["all", ...values.filter((value) => value !== McpToolExposureToken.ALL)].join(", ");
  return values.join(", ");
}

function formatMcpToolStatuses(server: McpServerConfig, tools: McpTool[]): string[] {
  if (tools.length === 0) return ["      none discovered"];
  const grouped = groupMcpToolsByExposure(server, tools);
  return [
    `      ${McpToolExposureStatus.EXPOSED}`,
    ...formatMcpToolGroup(grouped.exposed),
    `      ${McpToolExposureStatus.NOT_EXPOSED}`,
    ...formatMcpToolGroup(grouped.notExposed),
  ];
}

function groupMcpToolsByExposure(server: McpServerConfig, tools: McpTool[]): {exposed: string[]; notExposed: string[]} {
  const exposed: string[] = [];
  const notExposed: string[] = [];
  for (const tool of tools) {
    if (shouldExposeMcpTool(server, tool.name)) exposed.push(tool.name);
    else notExposed.push(tool.name);
  }
  return {exposed, notExposed};
}

function formatMcpToolGroup(toolNames: string[]): string[] {
  return toolNames.length > 0 ? toolNames.map((toolName) => `        ${toolName}`) : ["        none"];
}

function resolveServerTargets(config: McpConfigSnapshot, target: string | undefined): {serverNames: string[]} | {error: string} {
  if (!target || target === McpCommandTarget.ALL) return {serverNames: Object.keys(config.servers)};
  if (!config.servers[target]) return {error: `Unknown MCP server: ${target}`};
  return {serverNames: [target]};
}

function tokenizeMcpCommand(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

function firstMcpAction(tokens: string[]): McpCommandAction | null {
  const action = tokens[0] as McpCommandAction | undefined;
  return action && mcpCommandActions.includes(action) ? action : null;
}

function actionUsesToolOperands(action: McpCommandAction): boolean {
  return action === McpCommandAction.EXPOSE || action === McpCommandAction.HIDE || action === McpCommandAction.RESET;
}

function completionValues(values: readonly string[], current: string, base: string): AutocompleteItem[] {
  return values
    .filter((value) => value.startsWith(current))
    .map((value) => ({value: `${base}${value}`, label: value}));
}

function uniqueCompletionValues(values: readonly string[]): string[] {
  const unique = [...new Set(values.filter(Boolean))];
  return [
    ...unique.filter((value) => value === McpToolExposureToken.ALL),
    ...unique.filter((value) => value !== McpToolExposureToken.ALL).sort(),
  ];
}

function ok(message: string): McpCommandResult {
  return {kind: McpCommandMessageKind.INFO, message};
}

function err(message: string): McpCommandResult {
  return {kind: McpCommandMessageKind.ERROR, message};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
