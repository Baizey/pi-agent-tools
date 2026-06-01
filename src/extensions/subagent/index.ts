import {PiExtensionApi} from "../../pi/types";
import {toolNames} from "../../shared/toolNames";
import {renderToolCallInput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";
import {
  cancelAsyncSubagentJob,
  formatAwaitedJob,
  getAsyncSubagentJob,
  getAsyncSubagentJobs,
  jobDetails,
  sendConversationMessage,
  subagentJobStatuses,
  startAsyncSubagentJob,
  unfinishedJobIds,
  waitForJobs,
} from "./jobs";
import {subagentProfiles, subagentRunModes} from "./profiles";
import {normalizeJobIds, normalizeTimeout, parseSubagentRequest, RawJobParams, RawSubagentParams} from "./request";
import {errorResult, subagentResultResponse, successResult} from "./responses";
import {runSubagent} from "./runner";

export function registerSubagentTool(pi: PiExtensionApi): void {
  registerSubagent(pi);
  registerSubagentStatus(pi);
  registerSubagentAwait(pi);
  registerSubagentMessage(pi);
  registerSubagentCancel(pi);
}

function registerSubagent(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagentSpawn,
    label: "Subagent",
    description: "Run a scoped subagent. Supports sync one-shot and async job modes; conversation mode is reserved.",
    parameters: subagentParameters(),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = parseSubagentRequest(params as RawSubagentParams, ctx?.cwd ?? process.cwd());
      if ("error" in request) return errorResult(request.error);

      if (request.mode === subagentRunModes.async || request.mode === subagentRunModes.conversation) {
        const job = startAsyncSubagentJob(request);
        return successResult(
          request.mode === subagentRunModes.conversation
            ? `Started conversation subagent ${job.id}. Use ${toolNames.subagentMessage} to continue or ${toolNames.subagentCancel} when done.`
            : `Started async subagent job ${job.id}. Use ${toolNames.subagentStatus} to check progress.`,
          jobDetails(job),
        );
      }

      const result = await runSubagent(
        request,
        signal,
        typeof onUpdate === "function" ? (onUpdate as never) : undefined,
      );
      return subagentResultResponse(request, result);
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.subagentSpawn, args, theme as never);
    },
  });
}

function registerSubagentStatus(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagentStatus,
    label: "Subagent Status",
    description: "Check the status and result of an async subagent job.",
    parameters: singleJobParameters(),
    async execute(_toolCallId, params) {
      const jobId = stringValue((params as RawJobParams).jobId);
      if (!jobId) return errorResult("Missing required parameter: jobId.");
      const job = getAsyncSubagentJob(jobId);
      if (!job) return errorResult(`Unknown subagent job: ${jobId}`);

      if (job.result) return subagentResultResponse(job.request, job.result, jobDetails(job));
      return successResult(`Subagent job ${job.id} is ${job.status}.`, jobDetails(job));
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.subagentStatus, args, theme as never);
    },
  });
}

function registerSubagentAwait(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagentAwait,
    label: "Await Subagent",
    description: "Wait for one or more async subagent jobs to finish and return their results.",
    parameters: awaitJobParameters(),
    async execute(_toolCallId, params, signal) {
      const jobIds = normalizeJobIds((params as RawJobParams).jobIds);
      if (jobIds.length === 0) return errorResult("Missing required parameter: jobIds.");

      const {jobs, missing} = getAsyncSubagentJobs(jobIds);
      if (missing.length > 0) return errorResult(`Unknown subagent job(s): ${missing.join(", ")}`);

      const timeoutSeconds = normalizeTimeout((params as RawJobParams).timeoutSeconds, 300);
      const timedOut = !(await waitForJobs(jobs, timeoutSeconds, signal));
      const details = {jobs: jobs.map(jobDetails), timedOut};

      if (timedOut) {
        return {
          content: [{type: "text" as const, text: `Timed out waiting for subagent job(s): ${unfinishedJobIds(jobs).join(", ")}`}],
          details,
          isError: true,
        };
      }

      const text = jobs.map(formatAwaitedJob).join("\n\n---\n\n");
      const hasFailed = jobs.some((job) => job.status === subagentJobStatuses.failed || job.status === subagentJobStatuses.cancelled);
      return {
        content: [{type: "text" as const, text}],
        details,
        isError: hasFailed,
      };
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.subagentAwait, args, theme as never);
    },
  });
}

function registerSubagentMessage(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagentMessage,
    label: "Message Subagent",
    description: "Send another message to an idle conversation subagent.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["jobId", "task"],
      properties: {
        jobId: {type: "string", description: "Conversation subagent id returned by subagent."},
        task: {type: "string", description: "Next message/task for the conversation subagent."},
      },
    },
    async execute(_toolCallId, params) {
      const input = params as RawJobParams & {task?: unknown};
      const jobId = stringValue(input.jobId);
      if (!jobId) return errorResult("Missing required parameter: jobId.");
      const task = stringValue(input.task);
      if (!task) return errorResult("Missing required parameter: task.");
      const job = getAsyncSubagentJob(jobId);
      if (!job) return errorResult(`Unknown subagent job: ${jobId}`);
      if (job.request.mode !== subagentRunModes.conversation) return errorResult(`Subagent job ${jobId} is not a conversation.`);
      if (job.status !== subagentJobStatuses.idle) return errorResult(`Conversation subagent ${jobId} is ${job.status}, not idle.`);

      sendConversationMessage(job, task);
      return successResult(`Sent message to conversation subagent ${job.id}.`, jobDetails(job));
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.subagentMessage, args, theme as never);
    },
  });
}

function registerSubagentCancel(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagentCancel,
    label: "Cancel Subagent",
    description: "Cancel a running async subagent job.",
    parameters: singleJobParameters(),
    async execute(_toolCallId, params) {
      const jobId = stringValue((params as RawJobParams).jobId);
      if (!jobId) return errorResult("Missing required parameter: jobId.");
      const job = getAsyncSubagentJob(jobId);
      if (!job) return errorResult(`Unknown subagent job: ${jobId}`);
      if (job.status !== subagentJobStatuses.running && job.status !== subagentJobStatuses.idle) {
        return successResult(`Subagent job ${job.id} is already ${job.status}.`, jobDetails(job));
      }

      cancelAsyncSubagentJob(job);
      return successResult(`Cancelled subagent job ${job.id}.`, jobDetails(job));
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.subagentCancel, args, theme as never);
    },
  });
}

function subagentParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: {
      mode: {
        type: "string",
        enum: Object.values(subagentRunModes),
        description: "Run mode. Defaults to sync.",
        default: subagentRunModes.sync,
      },
      task: {
        type: "string",
        description: "Task to delegate to the subagent.",
      },
      profiles: {
        type: "array",
        items: {
          type: "string",
          enum: Object.keys(subagentProfiles),
        },
        description: "Capability profiles. Defaults to ['none']. Profiles are additive.",
      },
      cwd: {
        type: "string",
        description: "Working directory for the subagent. Defaults to current cwd.",
      },
      timeoutSeconds: {
        type: "number",
        description: "Timeout for this subagent run. Defaults based on mode.",
      },
      systemPrompt: {
        type: "string",
        description: "Optional extra system instructions for this subagent run.",
      },
      contextPaths: {
        type: "array",
        items: {type: "string"},
        description: "Optional context paths suggested to the subagent.",
      },
    },
  };
}

function singleJobParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["jobId"],
    properties: {
      jobId: {type: "string", description: "Async subagent job id returned by subagent."},
    },
  };
}

function awaitJobParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["jobIds"],
    properties: {
      jobIds: {
        type: "array",
        items: {type: "string"},
        description: "Async subagent job ids returned by subagent.",
      },
      timeoutSeconds: {
        type: "number",
        description: "Maximum time to wait. Defaults to 300 seconds.",
        default: 300,
      },
    },
  };
}

export * from "./profiles";
export {runSubagent, runSyncSubagent} from "./runner";
