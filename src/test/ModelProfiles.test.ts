import assert from "node:assert/strict";
import {test} from "node:test";
import {ExtensionContext} from "../pi/types";
import {agentModelProfiles, renderModelProfileConfig, resolvedModelForProfile} from "../extensions/subagent/model-profiles";
import {sanitizeModelProfileConfig} from "../extensions/subagent/model-profile-config";
import {parseModelProfileCommandArgs} from "../extensions/subagent/commands";

const ctx = {
  cwd: process.cwd(),
  modelRegistry: {
    async getAvailable() {
      return [
        {provider: "cheap", id: "text", input: ["text"], reasoning: false, cost: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0}},
        {provider: "expensive", id: "text", input: ["text"], reasoning: false, cost: {input: 10, output: 10, cacheRead: 0, cacheWrite: 0}},
        {provider: "cheap", id: "reasoning", input: ["text"], reasoning: true, cost: {input: 2, output: 2, cacheRead: 0, cacheWrite: 0}},
        {provider: "expensive", id: "reasoning", input: ["text"], reasoning: true, cost: {input: 20, output: 20, cacheRead: 0, cacheWrite: 0}},
      ];
    },
  },
} satisfies ExtensionContext;

test("model profile auto resolves through the algorithm", async () => {
  const result = await resolvedModelForProfile(ctx, agentModelProfiles.textLow, {});
  assert.equal(result.automatic, true);
  assert.equal(result.resolved, "cheap/text");
});

test("model profile override resolves to configured model", async () => {
  const result = await resolvedModelForProfile(ctx, agentModelProfiles.textLow, {text_low: "provider/model"});
  assert.equal(result.automatic, false);
  assert.equal(result.resolved, "provider/model");
});

test("model profile auto treats missing cost as low but not free", async () => {
  const result = await resolvedModelForProfile({
    cwd: process.cwd(),
    modelRegistry: {
      async getAvailable() {
        return [
          {provider: "unknown", id: "cost", input: ["text"], reasoning: false},
          {provider: "priced", id: "cost", input: ["text"], reasoning: false, cost: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0}},
        ];
      },
    },
  }, agentModelProfiles.textLow, {});
  assert.equal(result.resolved, "unknown/cost");
});

test("model profile display aligns resolved models and auto label", async () => {
  const lines = await renderModelProfileConfig(ctx, {text_low: "provider/model"});
  assert.equal(lines[0], "Model profiles");
  assert.ok(lines.some((line) => line.includes("text_low") && line.includes("→ provider/model") && !line.endsWith("auto")));
  assert.ok(lines.some((line) => line.includes("text_high") && line.includes("auto")));
});

test("model profile config ignores unknown profiles and malformed values", () => {
  assert.deepEqual(sanitizeModelProfileConfig({text_low: " provider/model ", nope: "x", text_high: 42}), {
    text_low: "provider/model",
  });
});

test("model profile command parser supports show, set, auto, and reset", () => {
  assert.deepEqual(parseModelProfileCommandArgs(""), {action: "show"});
  assert.deepEqual(parseModelProfileCommandArgs("text_low auto"), {action: "set", profile: "text_low", value: "auto"});
  assert.deepEqual(parseModelProfileCommandArgs("text_low provider/model"), {action: "set", profile: "text_low", value: "provider/model"});
  assert.deepEqual(parseModelProfileCommandArgs("reset text_low"), {action: "reset", profile: "text_low"});
  assert.equal(parseModelProfileCommandArgs("unknown auto").action, "error");
});
