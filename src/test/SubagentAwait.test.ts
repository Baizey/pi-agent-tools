import assert from "node:assert/strict";
import {test} from "./TestHarness";
import {PiExtensionApi, registerSubagentTool, subagentRunModes, toolNames} from "../index";
import {
  AsyncSubagentJob,
  defaultSubagentAwaitTimeoutSeconds,
  formatTimedOutJobs,
  subagentJobStatuses,
} from "../extensions/subagent/jobs";

function fakeJob(overrides: Partial<AsyncSubagentJob> = {}): AsyncSubagentJob {
  const startedAt = Date.now() - 5000;
  return {
    id: "job-1",
    request: {
      mode: subagentRunModes.async,
      task: "scan repository for subagent status handling",
      profiles: ["none"],
      cwd: process.cwd(),
      timeoutSeconds: 900,
    },
    status: subagentJobStatuses.running,
    startedAt,
    controller: new AbortController(),
    latestUpdateText: "Subagents\n└─ job-1 ⏳ reading files",
    history: [],
    ...overrides,
  };
}

test("subagent await tool defaults to a thirty second wait", () => {
  const tools: Record<string, {parameters: Record<string, unknown>}> = {};
  const pi = {
    registerTool(tool: {name: string; parameters: Record<string, unknown>}) {
      tools[tool.name] = tool;
    },
  } as PiExtensionApi;

  registerSubagentTool(pi);

  const awaitTool = tools[toolNames.subagentAwait];
  assert.ok(awaitTool);
  const timeoutParam = (((awaitTool.parameters.properties as Record<string, unknown>).timeoutSeconds) as {default?: number; description?: string});
  assert.equal(timeoutParam.default, defaultSubagentAwaitTimeoutSeconds);
  assert.equal(defaultSubagentAwaitTimeoutSeconds, 30);
  assert.match(timeoutParam.description ?? "", /30 seconds/);
});

test("timed out subagent await responses include current job statuses", () => {
  const text = formatTimedOutJobs([
    fakeJob(),
    fakeJob({
      id: "job-2",
      status: subagentJobStatuses.completed,
      finishedAt: Date.now(),
      latestUpdateText: "Subagents\n└─ job-2 ✓ done",
      request: {
        mode: subagentRunModes.async,
        task: "finished review",
        profiles: ["io_read"],
        cwd: process.cwd(),
        timeoutSeconds: 900,
      },
    }),
  ], defaultSubagentAwaitTimeoutSeconds);

  assert.match(text, /Timed out after 30s waiting for subagent job\(s\): job-1/);
  assert.match(text, /Current subagent statuses:/);
  assert.match(text, /job-1: running/);
  assert.match(text, /latest: └─ job-1 ⏳ reading files/);
  assert.match(text, /job-2: completed/);
  assert.match(text, /latest: └─ job-2 ✓ done/);
});
