import {ExtensionContext, PiExtensionApi} from "../../pi/types";
import {database_filename, normalizeSubagentPersonaName, SqliteDatabase, SubagentPersonaDao} from "../../storage";
import {ToolName} from "../../shared/toolNames";
import {FoldDirection, renderToolCallInput, renderToolResultOutput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";
import {
  cancelAsyncSubagentJob,
  formatSubagentJobs,
  getAsyncSubagentJob,
  getAsyncSubagentJobs,
  jobDetails,
  sendConversationMessage,
  SubagentJobStatus,
  SubagentWaitOutcome,
  startAsyncSubagentJob,
  waitForJobs,
} from "./jobs";
import {AgentModelProfile, resolveAgentModelProfile} from "./model-profiles";
import {defaultSubagentTimeoutSeconds, SubagentRunMode, subagentToolkits} from "./toolkits";
import {normalizeJobIds, parseSubagentRequest, RawJobParams, RawSubagentParams} from "./request";
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
  registerSubagentMessage(pi);
  registerSubagentStop(pi);
}

function registerSubagent(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: ToolName.subagentSpawn,
    label: "Subagent",
    description: "Run a scoped subagent. Supports sync one-shot, async job, and conversation modes.",
    parameters: subagentParameters(),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = parseSubagentRequest(params as RawSubagentParams, ctx?.cwd ?? process.cwd());
      if ("error" in request) return errorResult(request.error);
      return executeSubagentRequest(request, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(ToolName.subagentSpawn, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  });
}

function registerSubagentPersona(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: ToolName.subagentSpawnPersona,
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
      return renderToolCallInput(ToolName.subagentSpawnPersona, args, theme, context);
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

  if (request.mode === SubagentRunMode.async || request.mode === SubagentRunMode.conversation) {
    const job = startAsyncSubagentJob(request, treeUpdate);
    return successResult(
      request.mode === SubagentRunMode.conversation
        ? `Started conversation subagent ${job.id}. Use ${ToolName.subagentMessage} to continue or ${ToolName.subagentStop} when done.`
        : `Started async subagent job ${job.id}. Use ${ToolName.subagentStatus} to check progress.`,
      jobDetails(job),
    );
  }

  if (request.mode === SubagentRunMode.sync) {
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
    name: ToolName.subagentStatus,
    label: "Subagent Status",
    description: "Report one or more subagent jobs, optionally waiting for running jobs first.",
    parameters: statusJobParameters(),
    async execute(_toolCallId, params, signal) {
      const input = params as RawJobParams;
      const jobIds = normalizeJobIds(input.jobIds);
      if (jobIds.length === 0) return errorResult("Missing required parameter: jobIds.");

      const {jobs, missing} = getAsyncSubagentJobs(jobIds);
      if (missing.length > 0) return errorResult(`Unknown subagent job(s): ${missing.join(", ")}`);

      const timeoutSeconds = statusWaitTimeout(input.timeoutSeconds);
      if ("error" in timeoutSeconds) return errorResult(timeoutSeconds.error);
      const waitOutcome = timeoutSeconds.value === undefined
        ? SubagentWaitOutcome.settled
        : await waitForJobs(jobs, timeoutSeconds.value, signal);

      return {
        content: [{type: "text" as const, text: formatSubagentJobs(jobs)}],
        details: {
          jobs: jobs.map(jobDetails),
          timedOut: waitOutcome === SubagentWaitOutcome.timedOut,
          aborted: waitOutcome === SubagentWaitOutcome.aborted,
          timeoutSeconds: timeoutSeconds.value,
        },
        isError: jobs.some((job) => job.status === SubagentJobStatus.failed),
      };
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(ToolName.subagentStatus, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  });
}

function registerSubagentMessage(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: ToolName.subagentMessage,
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
      if (job.request.mode !== SubagentRunMode.conversation) return errorResult(`Subagent job ${jobId} is not a conversation.`);
      if (job.status !== SubagentJobStatus.idle) return errorResult(`Conversation subagent ${jobId} is ${job.status}, not idle.`);

      sendConversationMessage(job, task, subagentUiUpdater(onUpdate, ctx));
      return successResult(`Sent message to conversation subagent ${job.id}.`, jobDetails(job));
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(ToolName.subagentMessage, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  });
}

function registerSubagentStop(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: ToolName.subagentStop,
    label: "Stop Subagent",
    description: "Stop a running or idle subagent job.",
    parameters: singleJobParameters(),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const jobId = stringValue((params as RawJobParams).jobId);
      if (!jobId) return errorResult("Missing required parameter: jobId.");
      const job = getAsyncSubagentJob(jobId);
      if (!job) return errorResult(`Unknown subagent job: ${jobId}`);
      if (job.status !== SubagentJobStatus.running && job.status !== SubagentJobStatus.idle) {
        return successResult(`Subagent job ${job.id} is already ${job.status}.`, jobDetails(job));
      }

      cancelAsyncSubagentJob(job);
      updateSubagentWidget(ctx, job.request.treeRootId);
      return successResult(`Stopped subagent job ${job.id}.`, jobDetails(job));
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(ToolName.subagentStop, args, theme, context);
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
        enum: Object.values(SubagentRunMode),
        description: "Run mode. Defaults to sync.",
        default: SubagentRunMode.sync,
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
        description: `Optional model profile (${Object.values(AgentModelProfile).join(", ")}) or concrete provider/model id for the subagent.`,
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

function statusJobParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["jobIds"],
    properties: {
      jobIds: {
        type: "array",
        items: {type: "string"},
        description: "Subagent job ids to report.",
      },
      timeoutSeconds: {
        type: "number",
        description: "Optional maximum time to wait for running jobs. Omit to return immediately.",
        minimum: 1,
        maximum: 3600,
      },
    },
  };
}

function statusWaitTimeout(value: unknown): {value?: number} | {error: string} {
  if (value === undefined) return {value: undefined};
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return {error: "timeoutSeconds must be a positive number."};
  }
  return {value: Math.min(value, 3600)};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export * from "./toolkits";
export * from "./personas";
export {AgentModelProfile, isAgentModelProfile, resolveAgentModel, resolveAgentModelProfile} from "./model-profiles";
export {runSubagent, runSyncSubagent} from "./runner";
