import assert from "node:assert/strict";
import {test} from "./TestHarness";
import {agentEnv} from "../shared/env";
import {parseSubagentRequest} from "../extensions/subagent/request";
import {subagentRunModes} from "../extensions/subagent";

function withSubagentModel(value: string | undefined, fn: () => void): void {
  const previous = process.env[agentEnv.subagentModel];
  try {
    if (value === undefined) delete process.env[agentEnv.subagentModel];
    else process.env[agentEnv.subagentModel] = value;
    fn();
  } finally {
    if (previous === undefined) delete process.env[agentEnv.subagentModel];
    else process.env[agentEnv.subagentModel] = previous;
  }
}

test("subagent request uses PI_AGENT_SUBAGENT_MODEL when model parameter is absent", () => {
  withSubagentModel("text_low", () => {
    const request = parseSubagentRequest({task: "do it"}, process.cwd());
    assert.ok(!("error" in request));
    assert.equal(request.model, "text_low");
  });
});

test("subagent request model parameter overrides PI_AGENT_SUBAGENT_MODEL", () => {
  withSubagentModel("text_low", () => {
    const request = parseSubagentRequest({task: "do it", model: "provider/model"}, process.cwd());
    assert.ok(!("error" in request));
    assert.equal(request.model, "provider/model");
  });
});

test("subagent request defaults all run modes to fifteen minute timeouts", () => {
  for (const mode of Object.values(subagentRunModes)) {
    const request = parseSubagentRequest({task: "do it", mode}, process.cwd());
    assert.ok(!("error" in request));
    assert.equal(request.timeoutSeconds, 15 * 60);
  }
});
