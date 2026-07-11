import assert from "node:assert/strict";
import {PiExtensionApi, registerSubagentTool, SubagentRunMode, ToolName} from "../index";
import {
  AsyncSubagentJob,
  formatSubagentJob,
  formatSubagentJobs,
  SubagentJobStatus,
} from "../extensions/subagent/jobs";

function fakeJob(overrides: Partial<AsyncSubagentJob> = {}): AsyncSubagentJob {
  const startedAt = Date.now() - 5000;
  return {
    id: "job-1",
    request: {
      mode: SubagentRunMode.async,
      task: "scan repository for subagent status handling",
      role: "status scanner",
      toolkits: [],
      cwd: process.cwd(),
      timeoutSeconds: 900,
    },
    status: SubagentJobStatus.running,
    startedAt,
    controller: new AbortController(),
    latestUpdateText: "Subagents\n└─ status scanner (job-1) ⏳ reading files",
    statusUpdates: [],
    history: [],
    ...overrides,
  };
}

function fakeResult(output: string, overrides: Partial<NonNullable<AsyncSubagentJob["result"]>> = {}) {
  return {
    mode: SubagentRunMode.async,
    output,
    exitCode: 0,
    timedOut: false,
    stderr: "",
    messages: [],
    toolkits: {toolkits: [], tools: [], instructions: []},
    ...overrides,
  };
}

test("subagent status replaces await and only waits when a timeout is supplied", () => {
  const tools: Record<string, {parameters: Record<string, unknown>}> = {};
  const pi = {
    registerTool(tool: {name: string; parameters: Record<string, unknown>}) {
      tools[tool.name] = tool;
    },
  } as PiExtensionApi;

  registerSubagentTool(pi);

  const statusTool = tools[ToolName.subagentStatus];
  assert.ok(statusTool);
  assert.equal(tools["subagent_await"], undefined);
  assert.deepEqual(statusTool.parameters.required, ["jobIds"]);
  const timeoutParam = (((statusTool.parameters.properties as Record<string, unknown>).timeoutSeconds) as {default?: number; description?: string});
  assert.equal(timeoutParam.default, undefined);
  assert.match(timeoutParam.description ?? "", /Omit to return immediately/);
});

test("running and failed statuses report at most the last five activity updates", () => {
  const statusUpdates = ["one", "two", "three", "four", "five", "six"];
  const running = formatSubagentJob(fakeJob({statusUpdates}));
  assert.match(running, /^## Subagent status scanner \(job-1\)\n### Status: running/m);
  assert.doesNotMatch(running, /- one/);
  for (const update of statusUpdates.slice(-5)) assert.match(running, new RegExp(`- ${update}`));

  const failed = formatSubagentJob(fakeJob({
    status: SubagentJobStatus.failed,
    statusUpdates,
    result: fakeResult("process failed", {exitCode: 1, stderr: "permission denied"}),
  }));
  assert.match(failed, /### Status: failed/);
  assert.match(failed, /Error:\n\npermission denied/);
});

test("idle statuses preserve the response and explain that the conversation is awaiting input", () => {
  const text = formatSubagentJob(fakeJob({
    status: SubagentJobStatus.idle,
    request: {
      ...fakeJob().request,
      mode: SubagentRunMode.conversation,
      role: "implementation planner",
    },
    result: fakeResult("Here is the proposed plan.", {mode: SubagentRunMode.conversation}),
  }));

  assert.match(text, /^## Subagent implementation planner \(job-1\)\n### Status: idle/m);
  assert.match(text, /Here is the proposed plan\./);
  assert.match(text, /idle and awaiting further instructions or cancellation/);
});

test("completed and cancelled statuses have status-specific messages", () => {
  const text = formatSubagentJobs([
    fakeJob({status: SubagentJobStatus.completed, result: fakeResult("Review complete.")}),
    fakeJob({id: "job-2", status: SubagentJobStatus.cancelled}),
  ]);

  assert.match(text, /### Status: completed\n\nReview complete\./);
  assert.match(text, /## Subagent status scanner \(job-2\)\n### Status: cancelled/);
  assert.match(text, /successfully cancelled/);
});
