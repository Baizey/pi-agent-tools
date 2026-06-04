import assert from "node:assert/strict";
import {test} from "./TestHarness";
import {
  applySubagentProfileCeiling,
  parseSubagentProfileCeiling,
  resolveSubagentProfiles,
  serializeSubagentProfileCeiling,
} from "../extensions/subagent";

test("subagent profile ceiling prevents nested agents from escalating capabilities", () => {
  const parentProfiles = ["spawn_subagent"] as const;
  const requestedProfiles = ["spawn_subagent", "io_read", "io_write"] as const;

  assert.deepEqual(applySubagentProfileCeiling([...requestedProfiles], [...parentProfiles]), ["spawn_subagent"]);
});

test("subagent profile ceiling falls back to none when requested profiles exceed parent capabilities", () => {
  assert.deepEqual(applySubagentProfileCeiling(["io_read"], ["spawn_subagent"]), ["none"]);
  assert.deepEqual(resolveSubagentProfiles(["none"]).tools, []);
  assert.deepEqual(resolveSubagentProfiles(["none"]).instructions, ["You have access to no tools."]);
});

test("subagent profile ceiling allows only the intersection of requested and parent capabilities", () => {
  assert.deepEqual(
    applySubagentProfileCeiling(["io_read", "io_write", "execute_bash", "web_read", "spawn_subagent"], ["io_read", "web_read", "spawn_subagent"]),
    ["io_read", "web_read", "spawn_subagent"],
  );
});

test("subagent profile ceiling treats malformed inherited ceilings as no capabilities", () => {
  assert.deepEqual(parseSubagentProfileCeiling("totally_fake, also_fake"), ["none"]);
  assert.deepEqual(applySubagentProfileCeiling(["io_read"], parseSubagentProfileCeiling("totally_fake")), ["none"]);
});

test("subagent profile ceiling serialization round-trips without granting defaults", () => {
  const serialized = serializeSubagentProfileCeiling(["spawn_subagent"]);

  assert.equal(serialized, "spawn_subagent");
  assert.deepEqual(parseSubagentProfileCeiling(serialized), ["spawn_subagent"]);
});

test("spawn_subagent profile grants only delegation tooling", () => {
  assert.deepEqual(resolveSubagentProfiles(["spawn_subagent"]).tools, [
    "subagent_spawn",
    "subagent_status",
    "subagent_await",
    "subagent_message",
    "subagent_cancel",
  ]);
});

test("web_read profile grants web lookup tooling", () => {
  assert.deepEqual(resolveSubagentProfiles(["web_read"]).tools, ["web_lookup"]);
});
