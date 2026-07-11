import assert from "node:assert/strict";
import {
  applySubagentToolkitCeiling,
  normalizeSubagentToolkits,
  parseSubagentToolkitCeiling,
  resolveSubagentToolkits,
  serializeSubagentToolkitCeiling,
  SubagentToolkitName,
} from "../extensions/subagent";


test("subagent toolkit ceiling prevents nested agents from escalating capabilities", () => {
  const parentToolkits = [SubagentToolkitName.spawnSubagent];
  const requestedToolkits = [SubagentToolkitName.spawnSubagent, SubagentToolkitName.meta, SubagentToolkitName.ioRead, SubagentToolkitName.ioWrite];

  assert.deepEqual(applySubagentToolkitCeiling(requestedToolkits, parentToolkits), ["spawn_subagent"]);
});

test("subagent toolkit ceiling falls back to no toolkits when requested toolkits exceed parent capabilities", () => {
  assert.deepEqual(applySubagentToolkitCeiling([SubagentToolkitName.ioRead], [SubagentToolkitName.spawnSubagent]), []);
  assert.deepEqual(resolveSubagentToolkits([]).tools, []);
  assert.deepEqual(resolveSubagentToolkits([]).instructions, ["You have access to no tools."]);
});

test("subagent toolkit normalization defaults to no toolkits", () => {
  assert.deepEqual(normalizeSubagentToolkits(undefined), []);
  assert.deepEqual(normalizeSubagentToolkits([]), []);
  assert.deepEqual(normalizeSubagentToolkits(["totally_fake"]), []);
  assert.deepEqual(normalizeSubagentToolkits(["meta", "io_read", "meta"]), ["meta", "io_read"]);
});

test("subagent toolkit ceiling allows only the intersection of requested and parent capabilities", () => {
  assert.deepEqual(
    applySubagentToolkitCeiling(
      [SubagentToolkitName.meta, SubagentToolkitName.ioRead, SubagentToolkitName.ioWrite, SubagentToolkitName.executeBash, SubagentToolkitName.webRead, SubagentToolkitName.spawnSubagent],
      [SubagentToolkitName.meta, SubagentToolkitName.ioRead, SubagentToolkitName.webRead, SubagentToolkitName.spawnSubagent],
    ),
    ["meta", "io_read", "web_read", "spawn_subagent"],
  );
});

test("subagent toolkit ceiling treats malformed inherited ceilings as no capabilities", () => {
  assert.deepEqual(parseSubagentToolkitCeiling("totally_fake, also_fake"), []);
  assert.deepEqual(applySubagentToolkitCeiling([SubagentToolkitName.ioRead], parseSubagentToolkitCeiling("totally_fake")), []);
});

test("subagent toolkit ceiling serialization round-trips without granting defaults", () => {
  const serialized = serializeSubagentToolkitCeiling([SubagentToolkitName.spawnSubagent]);

  assert.equal(serialized, "spawn_subagent");
  assert.deepEqual(parseSubagentToolkitCeiling(serialized), ["spawn_subagent"]);
  assert.equal(serializeSubagentToolkitCeiling([]), "");
  assert.deepEqual(parseSubagentToolkitCeiling(""), []);
  assert.equal(parseSubagentToolkitCeiling(undefined), null);
});

test("meta toolkit grants harness introspection tooling", () => {
  assert.deepEqual(resolveSubagentToolkits([SubagentToolkitName.meta]).tools, ["policy_info", "local_sql"]);
});

test("io_read toolkit grants read-only filesystem tooling", () => {
  assert.deepEqual(resolveSubagentToolkits([SubagentToolkitName.ioRead]).tools, ["read", "stat"]);
});

test("spawn_subagent toolkit grants delegation and persona tooling", () => {
  assert.deepEqual(resolveSubagentToolkits([SubagentToolkitName.spawnSubagent]).tools, [
    "subagent_spawn",
    "subagent_spawn_persona",
    "available_personas",
    "subagent_status",
    "subagent_await",
    "subagent_message",
    "subagent_cancel",
  ]);
});

test("web_read toolkit grants web lookup tooling", () => {
  assert.deepEqual(resolveSubagentToolkits([SubagentToolkitName.webRead]).tools, ["web_lookup"]);
});
