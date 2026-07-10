import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {McpConfigStore, sanitizeMcpConfig} from "../extensions/mcp/config";
import {McpTransportKind} from "../extensions/mcp/types";

function tempFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-mcp-config-")), "mcp.json");
}

test("mcp config store loads an empty config when the file does not exist", () => {
  const file = tempFile();
  fs.rmSync(file, {force: true});
  const store = new McpConfigStore(file);

  assert.deepEqual(store.load(), {servers: {}});
});

test("mcp config sanitizes server definitions and exposure lists", () => {
  const config = sanitizeMcpConfig({
    servers: {
      filesystem: {
        transport: McpTransportKind.STDIO,
        command: " npx ",
        args: ["-y", 42, "server"],
        cwd: " . ",
        env: {TOKEN: "abc", BAD: 1},
        tools: {expose: ["read_file", "read_file", ""], hide: ["write_file", "read_file"]},
      },
      remote: {
        transport: McpTransportKind.HTTP,
        url: "https://example.com/mcp",
        headers: {Authorization: "Bearer $TOKEN", Bad: false},
        tools: {expose: ["*", "read_file"], hide: ["write_file"]},
      },
      "bad name": {command: "node"},
      missing: {transport: McpTransportKind.STDIO},
    },
  });

  assert.deepEqual(Object.keys(config.servers), ["filesystem", "remote"]);
  assert.equal(config.servers.filesystem.transport, McpTransportKind.STDIO);
  assert.deepEqual(config.servers.filesystem.tools, {hide: ["write_file", "read_file"]});
  assert.equal(config.servers.remote.transport, McpTransportKind.HTTP);
  assert.deepEqual(config.servers.remote.headers, {Authorization: "Bearer $TOKEN"});
  assert.deepEqual(config.servers.remote.tools, {expose: ["*"], hide: ["write_file"]});
});

test("mcp config store persists expose hide and reset changes", () => {
  const file = tempFile();
  const store = new McpConfigStore(file);
  store.save({
    servers: {
      filesystem: {
        transport: McpTransportKind.STDIO,
        command: "node",
        args: ["server.js"],
        env: {},
        enabled: true,
        autoConnect: true,
        tools: {},
        connectTimeoutMs: 1,
        listToolsTimeoutMs: 1,
        toolTimeoutMs: 1,
        toolMaxTotalTimeoutMs: 2,
      },
    },
  });

  store.setToolExposure("filesystem", "expose", ["read_file", "list_dir"]);
  store.setToolExposure("filesystem", "hide", ["write_file", "read_file"]);
  let loaded = store.load();
  assert.deepEqual(loaded.servers.filesystem.tools, {expose: ["list_dir"], hide: ["read_file", "write_file"]});

  store.resetToolExposure("filesystem", ["write_file"]);
  loaded = store.load();
  assert.deepEqual(loaded.servers.filesystem.tools, {expose: ["list_dir"], hide: ["read_file"]});

  store.resetToolExposure("filesystem");
  loaded = store.load();
  assert.deepEqual(loaded.servers.filesystem.tools, {});
});
