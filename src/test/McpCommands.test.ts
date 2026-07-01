import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {test} from "./TestHarness";
import {handleMcpCommand, mcpCommandCompletions} from "../extensions/mcp/commands";
import {McpConfigStore} from "../extensions/mcp/config";
import {McpConnectionState, McpManager} from "../extensions/mcp/client";
import {McpToolRegistry} from "../extensions/mcp/tools";
import {McpCommandAction, McpCommandMessageKind, McpConfigSnapshot, McpServerClient, McpTool, McpTransportKind} from "../extensions/mcp/types";
import {PiExtensionApi, ToolDefinition} from "../pi/types";

function initialConfig(tools: McpConfigSnapshot["servers"][string]["tools"] = {}): McpConfigSnapshot {
  return {
    servers: {
      fs: {
        transport: McpTransportKind.STDIO,
        command: "node",
        args: ["server.js"],
        env: {},
        enabled: true,
        autoConnect: true,
        tools,
        connectTimeoutMs: 100,
        listToolsTimeoutMs: 100,
        toolTimeoutMs: 100,
        toolMaxTotalTimeoutMs: 500,
      },
    },
  };
}

function tempStore(config: McpConfigSnapshot): McpConfigStore {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-mcp-command-")), "mcp.json");
  const store = new McpConfigStore(file);
  store.save(config);
  return store;
}

function fakeClient(tools: McpTool[], counts: {connected: number; closed: number}): McpServerClient {
  return {
    async connect() { counts.connected++; },
    async listTools() { return tools; },
    async callTool() { return {content: [{type: "text", text: "ok"}]}; },
    async close() { counts.closed++; },
  };
}

function harness(toolsExposure: McpConfigSnapshot["servers"][string]["tools"] = {}) {
  const tools: McpTool[] = [
    {name: "read_file", description: "Read", inputSchema: {type: "object"}},
    {name: "write_file", description: "Write", inputSchema: {type: "object"}},
  ];
  const counts = {connected: 0, closed: 0};
  const store = tempStore(initialConfig(toolsExposure));
  const manager = new McpManager(store.load(), () => fakeClient(tools, counts));
  const registered: ToolDefinition[] = [];
  const pi = {registerTool: (tool: ToolDefinition) => registered.push(tool)} satisfies Pick<PiExtensionApi, "registerTool">;
  const registry = new McpToolRegistry(pi, manager, store);
  return {store, manager, registry, registered, counts};
}

test("mcp command connects refreshes and registers exposed tools", async () => {
  const h = harness({expose: ["read_file", "write_file"]});
  const result = await handleMcpCommand(h, `${McpCommandAction.CONNECT} fs`);

  assert.equal(result.kind, McpCommandMessageKind.INFO);
  assert.equal(h.counts.connected, 1);
  assert.equal(h.registered.length, 2);
  assert.match(result.message, /Connected fs/);
  assert.equal(h.manager.snapshot().states[0].state, McpConnectionState.CONNECTED);

  const show = await handleMcpCommand(h, McpCommandAction.SHOW);
  assert.match(show.message, /MCP servers/);
  assert.match(show.message, /state connected \(2 tools\)/);
  assert.match(show.message, /tools\n      exposed\n        read_file\n        write_file\n      not exposed\n        none/);

  const showServer = await handleMcpCommand(h, `${McpCommandAction.SHOW} fs`);
  assert.match(showServer.message, /MCP server fs/);
  assert.doesNotMatch(showServer.message, /MCP servers/);
});

test("mcp command persists expose hide reset controls", async () => {
  const h = harness();
  await handleMcpCommand(h, `${McpCommandAction.CONNECT} fs`);
  assert.equal(h.registered.length, 0);
  const show = await handleMcpCommand(h, McpCommandAction.SHOW);
  assert.match(show.message, /tools\n      exposed\n        none\n      not exposed\n        read_file\n        write_file/);

  let result = await handleMcpCommand(h, `${McpCommandAction.EXPOSE} fs read_file`);
  assert.equal(result.kind, McpCommandMessageKind.INFO);
  assert.equal(h.registered.length, 1);
  assert.deepEqual(h.store.load().servers.fs.tools, {expose: ["read_file"]});

  result = await handleMcpCommand(h, `${McpCommandAction.HIDE} fs write_file`);
  assert.equal(result.kind, McpCommandMessageKind.INFO);
  assert.deepEqual(h.store.load().servers.fs.tools, {expose: ["read_file"], hide: ["write_file"]});
  assert.match(result.message, /calls are blocked immediately/);

  result = await handleMcpCommand(h, `${McpCommandAction.RESET} fs write_file`);
  assert.equal(result.kind, McpCommandMessageKind.INFO);
  assert.deepEqual(h.store.load().servers.fs.tools, {expose: ["read_file"]});

  result = await handleMcpCommand(h, `${McpCommandAction.RESET} fs`);
  assert.equal(result.kind, McpCommandMessageKind.INFO);
  assert.deepEqual(h.store.load().servers.fs.tools, {});
});

test("mcp command completes discovered tool names", async () => {
  const h = harness();
  await handleMcpCommand(h, `${McpCommandAction.CONNECT} fs`);

  const completions = mcpCommandCompletions(`${McpCommandAction.EXPOSE} fs read`, h.store.load(), (serverName) => h.manager.toolsFor(serverName).map((tool) => tool.name));
  assert.deepEqual(completions.map((completion) => completion.value), [`${McpCommandAction.EXPOSE} fs read_file`]);

  const allCompletions = mcpCommandCompletions(`${McpCommandAction.HIDE} fs `, h.store.load(), (serverName) => h.manager.toolsFor(serverName).map((tool) => tool.name));
  assert.deepEqual(allCompletions.map((completion) => completion.value), [
    `${McpCommandAction.HIDE} fs *`,
    `${McpCommandAction.HIDE} fs read_file`,
    `${McpCommandAction.HIDE} fs write_file`,
  ]);
});

test("mcp command disconnect closes clients", async () => {
  const h = harness();
  await handleMcpCommand(h, `${McpCommandAction.CONNECT} fs`);
  const result = await handleMcpCommand(h, `${McpCommandAction.DISCONNECT} fs`);

  assert.equal(result.kind, McpCommandMessageKind.INFO);
  assert.equal(h.counts.closed, 1);
  assert.equal(h.manager.snapshot().states[0].state, McpConnectionState.DISCONNECTED);
});
