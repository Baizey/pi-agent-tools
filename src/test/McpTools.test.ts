import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {McpConfigStore} from "../extensions/mcp/config";
import {McpManager} from "../extensions/mcp/client";
import {buildMcpPiToolNames, formatMcpResultText, McpToolRegistry, sanitizeToolNamePart} from "../extensions/mcp/tools";
import {McpCommandAction, McpConfigSnapshot, McpServerClient, McpTool, McpTransportKind} from "../extensions/mcp/types";
import {PiExtensionApi, ToolDefinition} from "../pi/types";

function config(): McpConfigSnapshot {
  return {
    servers: {
      fs: {
        transport: McpTransportKind.STDIO,
        command: "node",
        args: ["server.js"],
        env: {},
        enabled: true,
        autoConnect: true,
        tools: {expose: ["read-file"]},
        connectTimeoutMs: 100,
        listToolsTimeoutMs: 100,
        toolTimeoutMs: 100,
        toolMaxTotalTimeoutMs: 500,
      },
    },
  };
}

function tempStore(initial: McpConfigSnapshot): McpConfigStore {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-mcp-tools-")), "mcp.json");
  const store = new McpConfigStore(file);
  store.save(initial);
  return store;
}

function fakeClient(tools: McpTool[]): McpServerClient {
  return {
    async connect() {},
    async listTools() { return tools; },
    async callTool(toolName, args) {
      return {
        content: [{type: "text", text: `called ${toolName} ${JSON.stringify(args)}`}],
        structuredContent: {ok: true},
      };
    },
    async close() {},
  };
}

test("mcp tool names are sanitized and collision-safe", () => {
  assert.equal(sanitizeToolNamePart("Read File!"), "read_file");
  const names = buildMcpPiToolNames("My Server", ["read-file", "read_file"]);
  assert.equal(names.get("read-file"), "mcp_my_server_read_file");
  assert.match(names.get("read_file") ?? "", /^mcp_my_server_read_file_[a-f0-9]{8}$/);
});

test("mcp result conversion preserves text images resources and structured fallback", () => {
  const result = formatMcpResultText({
    content: [
      {type: "text", text: "hello"},
      {type: "image", data: "abc", mimeType: "image/png"},
      {type: "resource_link", name: "doc", uri: "file:///doc"},
      {type: "resource", resource: {uri: "file:///r", text: "body"}},
    ],
  });

  assert.deepEqual(result.contentTypes, ["text", "image", "resource_link", "resource"]);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[1].type, "image");
  assert.match((result.content[2] as {text: string}).text, /resource link/);
  assert.match((result.content[3] as {text: string}).text, /body/);

  const fallback = formatMcpResultText({structuredContent: {answer: 1}});
  assert.deepEqual(fallback.contentTypes, ["structuredContent"]);
  assert.match((fallback.content[0] as {text: string}).text, /"answer": 1/);

  const legacyFallback = formatMcpResultText({toolResult: {answer: 2}});
  assert.deepEqual(legacyFallback.contentTypes, ["toolResult"]);
  assert.match((legacyFallback.content[0] as {text: string}).text, /"answer": 2/);
});

test("mcp registry registers exposed tools and blocks newly hidden tools at execution time", async () => {
  const tools: McpTool[] = [
    {name: "read-file", description: "Read", inputSchema: {type: "object", properties: {path: {type: "string"}}}},
    {name: "write-file", description: "Write", inputSchema: {type: "object"}},
  ];
  const initial = config();
  const store = tempStore(initial);
  const manager = new McpManager(initial, () => fakeClient(tools));
  await manager.connect("fs");

  const registered: ToolDefinition[] = [];
  const pi = {registerTool: (tool: ToolDefinition) => registered.push(tool)} satisfies Pick<PiExtensionApi, "registerTool">;
  const registry = new McpToolRegistry(pi, manager, store);
  const registration = registry.registerAvailableTools(initial);

  assert.equal(registration.registered.length, 1);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "mcp_fs_read_file");

  let call = await registered[0].execute("1", {path: "a.txt"});
  assert.equal(call.isError, undefined);
  assert.match((call.content[0] as {text: string}).text, /called read-file/);
  assert.deepEqual((call.details as {structuredContent?: unknown} | undefined)?.structuredContent, {ok: true});

  store.setToolExposure("fs", McpCommandAction.HIDE, ["read-file"]);
  manager.updateConfig(store.load());
  call = await registered[0].execute("2", {path: "a.txt"});
  assert.equal(call.isError, true);
  assert.match((call.content[0] as {text: string}).text, /not exposed/);
});
