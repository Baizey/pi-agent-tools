import {ExtensionContext, PiExtensionApi} from "../../pi/types";
import {database_filename, normalizeSubagentPersonaName, SqliteDatabase, SubagentPersonaDao} from "../../storage";
import {toolNames} from "../../shared/toolNames";
import {FoldDirection, renderToolCallInput, renderToolResultOutput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";
import {
  cancelAsyncSubagentJob,
  defaultSubagentAwaitTimeoutSeconds,
  formatAwaitedJob,
  formatTimedOutJobs,
  getAsyncSubagentJob,
  getAsyncSubagentJobs,
  jobDetails,
  sendConversationMessage,
  subagentJobStatuses,
  startAsyncSubagentJob,
  waitForJobs,
} from "./jobs";
import {agentModelProfiles, resolveAgentModelProfile} from "./model-profiles";
import {defaultSubagentTimeoutSeconds, subagentRunModes, subagentToolkits} from "./toolkits";
import {normalizeJobIds, normalizeTimeout, parseSubagentRequest, RawJobParams, RawSubagentParams} from "./request";
import {errorResult, subagentResultResponse, successResult} from "./responses";
import {registerSubagentCommands, updateSubagentWidget} from "./commands";
import {
  buildSubagentRequestFromPersona,
  currentSubagentToolkitCeiling,
  missingSubagentPersonaToolkits,
  RawSubagentPersonaSpawnParams,
  registerAvailablePersonasTool,
} from "./personas";
import {runSubagent, type SubagentRequest, type SubagentUpdate} from "./runner";

export function registerSubagentTool(pi: PiExtensionApi): void {
  registerSubagentCommands(pi);
  registerAvailablePersonasTool(pi);
  registerSubagent(pi);
  registerSubagentPersona(pi);
  registerSubagentStatus(pi);
  registerSubagentAwait(pi);
  registerSubagentMessage(pi);
  registerSubagentCancel(pi);
}

function registerSubagent(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagentSpawn,
    label: "Subagent",
    description: "Run a scoped subagent. Supports sync one-shot, async job, and conversation modes.",
    parameters: subagentParameters(),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = parseSubagentRequest(params as RawSubagentParams, ctx?.cwd ?? process.cwd());
      if ("error" in request) return errorResult(request.error);
      return executeSubagentRequest(request, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(toolNames.subagentSpawn, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  });
}

function registerSubagentPersona(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagentSpawnPersona,
    label: "Subagent Persona",
    description: "Spawn a subagent from a registered persona preset. Provide only the persona name, task, and optional timeout.",
    parameters: subagentPersonaParameters(),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as RawSubagentPersonaSpawnParams;
      const personaName = normalizeSubagentPersonaName(input.persona);
      if (!personaName) return errorResult("Missing or invalid required parameter: persona.");

      let db: SqliteDatabase;
      try {
        db = SqliteDatabase.readwrite(database_filename);
      } catch (error) {
        return errorResult(`Could not open subagent persona registry: ${errorMessage(error)}`);
      }

      try {
        const dao = new SubagentPersonaDao(db).initializeSchema();
        dao.seedBuiltinPersonas();
        const persona = dao.getEnabledPersona(personaName);
        if (!persona) return errorResult(`Unknown or disabled subagent persona: ${personaName}`);

        const missingToolkits = missingSubagentPersonaToolkits(persona.toolkits, currentSubagentToolkitCeiling());
        if (missingToolkits.length > 0) {
          return errorResult(`Subagent persona ${persona.name} requires unavailable toolkit(s): ${missingToolkits.join(", ")}.`);
        }

        const request = buildSubagentRequestFromPersona(input, persona, ctx?.cwd ?? process.cwd());
        if ("error" in request) return errorResult(request.error);
        return executeSubagentRequest(request, signal, onUpdate, ctx, {requireResolvedModel: true});
      } finally {
        db.close();
      }
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(toolNames.subagentSpawnPersona, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  });
}

async function executeSubagentRequest(
  request: SubagentRequest,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: ExtensionContext | undefined,
  options: {requireResolvedModel?: boolean} = {},
) {
  const configuredModel = request.model;
  request.model = await resolveAgentModelProfile(ctx, request.model);
  if (options.requireResolvedModel && !request.model) {
    return errorResult(`Could not resolve required model for subagent persona ${request.persona ?? request.role}: ${configuredModel ?? "(missing)"}.`);
  }

  request.rootSessionId = ctx?.sessionManager?.getSessionId();
  const treeUpdate = subagentUiUpdater(onUpdate, ctx);

  if (request.mode === subagentRunModes.async || request.mode === subagentRunModes.conversation) {
    const job = startAsyncSubagentJob(request, treeUpdate);
    return successResult(
      request.mode === subagentRunModes.conversation
        ? `Started conversation subagent ${job.id}. Use ${toolNames.subagentMessage} to continue or ${toolNames.subagentCancel} when done.`
        : `Started async subagent job ${job.id}. Use ${toolNames.subagentStatus} to check progress.`,
      jobDetails(job),
    );
  }

  if (request.mode === subagentRunModes.sync) {
    const result = await runSubagent(
      request,
      signal,
      treeUpdate,
    );
    return subagentResultResponse(request, result);
  }

  return errorResult(`Invalid subagent run mode: ${String(request.mode)}.`);
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
    renderCall(args, theme, context) {
      return renderToolCallInput(toolNames.subagentStatus, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
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

      const timeoutSeconds = normalizeTimeout((params as RawJobParams).timeoutSeconds, defaultSubagentAwaitTimeoutSeconds);
      const timedOut = !(await waitForJobs(jobs, timeoutSeconds, signal));
      const details = {jobs: jobs.map(jobDetails), timedOut, timeoutSeconds};

      if (timedOut) {
        return {
          content: [{type: "text" as const, text: formatTimedOutJobs(jobs, timeoutSeconds)}],
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
    renderCall(args, theme, context) {
      return renderToolCallInput(toolNames.subagentAwait, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
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
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const input = params as RawJobParams & {task?: unknown};
      const jobId = stringValue(input.jobId);
      if (!jobId) return errorResult("Missing required parameter: jobId.");
      const task = stringValue(input.task);
      if (!task) return errorResult("Missing required parameter: task.");
      const job = getAsyncSubagentJob(jobId);
      if (!job) return errorResult(`Unknown subagent job: ${jobId}`);
      if (job.request.mode !== subagentRunModes.conversation) return errorResult(`Subagent job ${jobId} is not a conversation.`);
      if (job.status !== subagentJobStatuses.idle) return errorResult(`Conversation subagent ${jobId} is ${job.status}, not idle.`);

      sendConversationMessage(job, task, subagentUiUpdater(onUpdate, ctx));
      return successResult(`Sent message to conversation subagent ${job.id}.`, jobDetails(job));
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(toolNames.subagentMessage, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  });
}

function registerSubagentCancel(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagentCancel,
    label: "Cancel Subagent",
    description: "Cancel a running async subagent job.",
    parameters: singleJobParameters(),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const jobId = stringValue((params as RawJobParams).jobId);
      if (!jobId) return errorResult("Missing required parameter: jobId.");
      const job = getAsyncSubagentJob(jobId);
      if (!job) return errorResult(`Unknown subagent job: ${jobId}`);
      if (job.status !== subagentJobStatuses.running && job.status !== subagentJobStatuses.idle) {
        return successResult(`Subagent job ${job.id} is already ${job.status}.`, jobDetails(job));
      }

      cancelAsyncSubagentJob(job);
      updateSubagentWidget(ctx, job.request.treeRootId);
      return successResult(`Cancelled subagent job ${job.id}.`, jobDetails(job));
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(toolNames.subagentCancel, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  });
}

function subagentUiUpdater(onUpdate: unknown, ctx: Pick<ExtensionContext, "ui" | "sessionManager"> | undefined): SubagentUpdate | undefined {
  if (typeof onUpdate !== "function" && !ctx?.ui?.setWidget) return undefined;
  return (partial) => {
    if (typeof onUpdate === "function") (onUpdate as SubagentUpdate)(partial);
    updateSubagentWidget(ctx);
  };
}

function subagentParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["task", "role"],
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
      role: {
        type: "string",
        description: "Required concise role/title for this subagent, e.g. reviewer, researcher, or migration planner.",
      },
      toolkits: {
        type: "array",
        items: {
          type: "string",
          enum: Object.keys(subagentToolkits),
        },
        description: "Toolkits grant task-specific tool groups. Defaults to no toolkits, which grants no tools. Toolkits are additive; use 'meta' for harness introspection.",
      },
      cwd: {
        type: "string",
        description: "Working directory for the subagent. Defaults to current cwd.",
      },
      timeoutSeconds: {
        type: "number",
        description: `Timeout for this subagent run. Defaults to ${defaultSubagentTimeoutSeconds} seconds (15 minutes).`,
      },
      model: {
        type: "string",
        description: `Optional model profile (${Object.values(agentModelProfiles).join(", ")}) or concrete provider/model id for the subagent.`,
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

function subagentPersonaParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["persona", "task"],
    properties: {
      persona: {
        type: "string",
        description: "Registered persona name to spawn, e.g. reviewer, researcher, planner, or rubber-duck.",
      },
      task: {
        type: "string",
        description: "Task to delegate to the persona-spawned subagent.",
      },
      timeoutSeconds: {
        type: "number",
        description: "Optional timeout for this run. Defaults according to the persona mode.",
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
        description: `Maximum time to wait. Defaults to ${defaultSubagentAwaitTimeoutSeconds} seconds.`,
        default: defaultSubagentAwaitTimeoutSeconds,
      },
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export * from "./toolkits";
export * from "./personas";
export {agentModelProfiles, isAgentModelProfile, resolveAgentModel, resolveAgentModelProfile} from "./model-profiles";
export {runSubagent, runSyncSubagent} from "./runner";
