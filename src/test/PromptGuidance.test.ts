import assert from "node:assert/strict";
import fs from "node:fs";
import {
  agentGuidePath,
  agentHelpGuidanceHeader,
  agentToolsGuidanceHeader,
  appendAgentPromptGuidance,
  engineeringPrincipleGuidance,
  engineeringPrincipleHeader,
} from "../extensions/prompt-guidance";
import {ToolName} from "../shared/toolNames";

test("agent prompt guidance always includes the engineering principle", () => {
  const prompt = appendAgentPromptGuidance("base prompt", {selectedTools: []});

  assert.match(prompt, new RegExp(engineeringPrincipleHeader));
  assert.match(prompt, /stable behavioral contract/);
  assert.doesNotMatch(prompt, new RegExp(agentToolsGuidanceHeader));
});

test("agent prompt guidance links help before tool guidance", () => {
  const prompt = appendAgentPromptGuidance("base prompt", {selectedTools: [ToolName.read]});

  assert.ok(prompt.indexOf(engineeringPrincipleHeader) < prompt.indexOf(agentHelpGuidanceHeader));
  assert.ok(prompt.indexOf(agentHelpGuidanceHeader) < prompt.indexOf(agentToolsGuidanceHeader));
  assert.match(prompt, /pi-agent-tools agent guide/);
  assert.ok(fs.existsSync(agentGuidePath), agentGuidePath);
  assert.match(prompt, /Filesystem tools:/);
});

test("agent prompt guidance is independently idempotent by section", () => {
  const existing = `base prompt\n\n${engineeringPrincipleGuidance}`;
  const prompt = appendAgentPromptGuidance(existing, {selectedTools: [ToolName.read]});
  const repeated = appendAgentPromptGuidance(prompt, {selectedTools: [ToolName.read]});

  assert.equal(prompt.match(new RegExp(engineeringPrincipleHeader, "g"))?.length, 1);
  assert.equal(prompt.match(new RegExp(agentHelpGuidanceHeader, "g"))?.length, 1);
  assert.equal(prompt.match(new RegExp(agentToolsGuidanceHeader, "g"))?.length, 1);
  assert.equal(repeated, prompt);
});
