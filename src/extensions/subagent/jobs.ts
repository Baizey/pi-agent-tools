import {readSubagentTreeContext} from "./tree-ui";
import {SubagentRunMode} from "./toolkits";
import {database_filename, SqliteDatabase, SubagentDao, SubagentRunStatus} from "../../storage";
import {runSubagent, SubagentRequest, SubagentResult, SubagentUpdate} from "./runner";

export enum SubagentJobStatus {
  running = "running",
  idle = "idle",
  completed = "completed",
  failed = "failed",
  cancelled = "cancelled",
}


export type AsyncSubagentJob = {
  id: string;
  request: SubagentRequest;
  status: SubagentJobStatus;
  startedAt: number;
  finishedAt?: number;
  controller: AbortController;
  result?: SubagentResult;
  error?: string;
  latestUpdateText?: string;
  latestUpdateDetails?: Record<string, unknown>;
  statusUpdates: string[];
  history: Array<{task: string; output: string}>;
};

export enum SubagentWaitOutcome {
  settled = "settled",
  timedOut = "timed_out",
  aborted = "aborted",
}

const asyncJobs = new Map<string, AsyncSubagentJob>();

export function startAsyncSubagentJob(request: SubagentRequest, onUpdate?: SubagentUpdate): AsyncSubagentJob {
  const context = readSubagentTreeContext();
  const identity = reserveJobIdentity(request, context);
  request.treeNodeId = identity.id;
  request.treeParentId = identity.parentId;
  request.treeRootId = identity.rootId;
  request.treeDepth = identity.depth;
  const controller = new AbortController();
  const job: AsyncSubagentJob = {
    id: identity.id,
    request,
    status: SubagentJobStatus.running,
    startedAt: Date.now(),
    controller,
    statusUpdates: [],
    history: [],
  };
  asyncJobs.set(identity.id, job);

  runJob(job, request, request.task, onUpdate);
  return job;
}

export function getAsyncSubagentJob(jobId: string): AsyncSubagentJob | undefined {
  return asyncJobs.get(jobId);
}

export function getAsyncSubagentJobs(jobIds: string[]): {jobs: AsyncSubagentJob[]; missing: string[]} {
  const jobs: AsyncSubagentJob[] = [];
  const missing: string[] = [];

  for (const jobId of jobIds) {
    const job = asyncJobs.get(jobId);
    if (job) jobs.push(job);
    else missing.push(jobId);
  }

  return {jobs, missing};
}

export function sendConversationMessage(job: AsyncSubagentJob, task: string, onUpdate?: SubagentUpdate): void {
  if (job.status !== SubagentJobStatus.idle) return;
  job.status = SubagentJobStatus.running;
  job.finishedAt = undefined;
  job.result = undefined;
  job.error = undefined;
  job.statusUpdates = [];
  job.controller = new AbortController();
  const request: SubagentRequest = {
    ...job.request,
    task,
    systemPrompt: [
      job.request.systemPrompt,
      "Conversation history:",
      ...job.history.map((entry, index) => `Turn ${index + 1} user: ${entry.task}\nTurn ${index + 1} assistant: ${entry.output}`),
    ].filter(Boolean).join("\n\n"),
  };
  job.request = request;
  runJob(job, request, task, onUpdate);
}

export function cancelAsyncSubagentJob(job: AsyncSubagentJob): void {
  if (job.status !== SubagentJobStatus.running && job.status !== SubagentJobStatus.idle) return;
  job.status = SubagentJobStatus.cancelled;
  job.finishedAt = Date.now();
  updatePersistedJob(job.id, SubagentRunStatus.cancelled, "cancelled");
  job.controller.abort();
}

export async function waitForJobs(
  jobs: AsyncSubagentJob[],
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<SubagentWaitOutcome> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (jobs.some((job) => job.status === SubagentJobStatus.running)) {
    if (signal?.aborted) return SubagentWaitOutcome.aborted;
    if (Date.now() >= deadline) return SubagentWaitOutcome.timedOut;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return SubagentWaitOutcome.settled;
}

export function formatSubagentJobs(jobs: AsyncSubagentJob[]): string {
  return jobs.map(formatSubagentJob).join("\n\n");
}

export function formatSubagentJob(job: AsyncSubagentJob): string {
  const heading = `## Subagent ${job.request.role} (${job.id})\n### Status: ${job.status}`;

  switch (job.status) {
    case SubagentJobStatus.running:
      return `${heading}\n${formatRecentUpdates(job)}`;
    case SubagentJobStatus.idle:
      return [
        heading,
        job.result?.output ?? "(no response was returned)",
        "This agent is currently idle and awaiting further instructions or cancellation.",
      ].join("\n\n");
    case SubagentJobStatus.completed:
      return [heading, job.result?.output ?? "(no response was returned)"].join("\n\n");
    case SubagentJobStatus.failed: {
      const error = failedJobError(job);
      return [
        `${heading}\n${formatRecentUpdates(job)}`,
        error ? `Error:\n\n${error}` : "No additional error information was reported.",
      ].join("\n\n");
    }
    case SubagentJobStatus.cancelled:
      return [heading, "The subagent was successfully cancelled."].join("\n\n");
  }
}

export function jobDetails(job: AsyncSubagentJob): Record<string, unknown> {
  return {
    jobId: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    task: job.request.task,
    role: job.request.role,
    persona: job.request.persona,
    mode: job.request.mode,
    cwd: job.request.cwd,
    timeoutSeconds: job.request.timeoutSeconds,
    toolkits: job.request.toolkits,
    error: job.error,
    latestUpdateText: job.latestUpdateText,
    latestUpdateDetails: job.latestUpdateDetails,
    statusUpdates: job.statusUpdates,
    historyLength: job.history.length,
  };
}

function updatePersistedJob(
  id: string,
  status: SubagentRunStatus.cancelled | SubagentRunStatus.failed,
  latestLine: string,
): void {
  const db = SqliteDatabase.readwrite(database_filename);
  try {
    new SubagentDao(db).initializeSchema().finishRun(id, status, {
      latestLine,
      error: status === SubagentRunStatus.failed ? latestLine : null,
    });
  } finally {
    db.close();
  }
}

function reserveJobIdentity(
  request: SubagentRequest,
  context: {rootId?: string; nodeId?: string; depth: number},
): {id: string; parentId: string | undefined; rootId: string; depth: number} {
  const db = SqliteDatabase.readwrite(database_filename);
  try {
    const subagents = new SubagentDao(db).initializeSchema();
    const parentId = context.nodeId;
    const rootId = context.rootId ?? request.rootSessionId ?? `subagent-${process.pid}-${Date.now()}`;
    const ordinal = subagents.nextOrdinal(parentId ?? null, rootId);
    const id = parentId ? `${parentId}-${ordinal}` : `${rootId}-${ordinal}`;
    subagents.startRun({
      id,
      rootId,
      parentId,
      ordinal,
      depth: parentId ? context.depth + 1 : 0,
      mode: request.mode,
      task: request.task,
      role: request.role,
      persona: request.persona,
      toolkits: request.toolkits,
      tools: [],
    });
    return {id, parentId, rootId, depth: parentId ? context.depth + 1 : 0};
  } finally {
    db.close();
  }
}

function runJob(job: AsyncSubagentJob, request: SubagentRequest, task: string, onUpdate?: SubagentUpdate): void {
  const captureUpdate: SubagentUpdate = (partial) => {
    const text = partial.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) {
      job.latestUpdateText = text;
      recordStatusUpdate(job, text);
    }
    job.latestUpdateDetails = partial.details;
    onUpdate?.(partial);
  };

  void runSubagent(request, job.controller.signal, captureUpdate)
    .then((result) => {
      if (job.status === SubagentJobStatus.cancelled) return;
      job.result = result;
      job.history.push({task, output: result.output});
      job.status = result.exitCode === 0 && !result.timedOut
        ? request.mode === SubagentRunMode.conversation ? SubagentJobStatus.idle : SubagentJobStatus.completed
        : SubagentJobStatus.failed;
      job.finishedAt = job.status === SubagentJobStatus.idle ? undefined : Date.now();
    })
    .catch((error) => {
      if (job.status === SubagentJobStatus.cancelled) return;
      job.status = SubagentJobStatus.failed;
      job.error = error instanceof Error ? error.message : String(error);
      job.finishedAt = Date.now();
      updatePersistedJob(job.id, SubagentRunStatus.failed, job.error);
    });
}

function recordStatusUpdate(job: AsyncSubagentJob, text: string): void {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ownLine = lines.find((line) => line.includes(`(${job.id})`));
  const update = ownLine ?? lines[lines.length - 1];
  if (!update || job.statusUpdates[job.statusUpdates.length - 1] === update) return;
  job.statusUpdates.push(update);
  if (job.statusUpdates.length > 5) job.statusUpdates.splice(0, job.statusUpdates.length - 5);
}

function formatRecentUpdates(job: AsyncSubagentJob): string {
  const updates = job.statusUpdates.length > 0
    ? job.statusUpdates.slice(-5)
    : job.latestUpdateText
      ? [lastMeaningfulLine(job.latestUpdateText)]
      : [];
  if (updates.length === 0) return "No status updates have been reported yet.";
  return ["Recent updates:", ...updates.map((update) => `- ${update}`)].join("\n");
}

function failedJobError(job: AsyncSubagentJob): string | undefined {
  if (job.error) return job.error;
  if (!job.result) return undefined;
  if (job.result.timedOut) {
    const details = job.result.stderr.trim() || job.result.output.trim();
    return details ? `Subagent timed out.\n${details}` : "Subagent timed out.";
  }
  return job.result.stderr.trim() || job.result.output.trim() || undefined;
}

function lastMeaningfulLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? text.trim();
}
