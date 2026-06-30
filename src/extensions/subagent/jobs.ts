import {readSubagentTreeContext} from "./tree-ui";
import {subagentRunModes} from "./profiles";
import {database_filename, SqliteDatabase, SubagentDao} from "../../storage";
import {runSubagent, SubagentRequest, SubagentResult, SubagentUpdate} from "./runner";

export const subagentJobStatuses = {
  running: "running",
  idle: "idle",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type SubagentJobStatus = typeof subagentJobStatuses[keyof typeof subagentJobStatuses];

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
  history: Array<{task: string; output: string}>;
};

export const defaultSubagentAwaitTimeoutSeconds = 30;

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
    status: subagentJobStatuses.running,
    startedAt: Date.now(),
    controller,
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
  if (job.status !== subagentJobStatuses.idle) return;
  job.status = subagentJobStatuses.running;
  job.finishedAt = undefined;
  job.result = undefined;
  job.error = undefined;
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
  if (job.status !== subagentJobStatuses.running && job.status !== subagentJobStatuses.idle) return;
  job.status = subagentJobStatuses.cancelled;
  job.finishedAt = Date.now();
  updatePersistedJob(job.id, subagentJobStatuses.cancelled, "cancelled");
  job.controller.abort();
}

export async function waitForJobs(
  jobs: AsyncSubagentJob[],
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(1, timeoutSeconds) * 1000;

  while (jobs.some((job) => job.status === subagentJobStatuses.running)) {
    if (signal?.aborted || Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return true;
}

export function unfinishedJobIds(jobs: AsyncSubagentJob[]): string[] {
  return jobs.filter((job) => job.status === subagentJobStatuses.running).map((job) => job.id);
}

export function formatAwaitedJob(job: AsyncSubagentJob): string {
  if (job.result) return `### ${job.id} (${job.status})\n\n${job.result.output}`;
  return `### ${job.id} (${job.status})\n\n${job.error ?? "(no output)"}`;
}

export function formatTimedOutJobs(jobs: AsyncSubagentJob[], timeoutSeconds: number): string {
  const unfinished = unfinishedJobIds(jobs);
  return [
    `Timed out after ${timeoutSeconds}s waiting for subagent job(s): ${unfinished.length > 0 ? unfinished.join(", ") : "(none still running)"}`,
    "",
    "Current subagent statuses:",
    ...jobs.map(formatJobStatus),
  ].join("\n");
}

export function formatJobStatus(job: AsyncSubagentJob): string {
  const elapsedSeconds = Math.max(0, Math.floor(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000));
  const latest = latestStatusText(job);
  return [
    `- ${job.id}: ${job.status}`,
    `task: ${shorten(job.request.task, 100)}`,
    `elapsed: ${elapsedSeconds}s`,
    latest ? `latest: ${shorten(latest, 140)}` : undefined,
  ].filter(Boolean).join("; ");
}

export function jobDetails(job: AsyncSubagentJob): Record<string, unknown> {
  return {
    jobId: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    task: job.request.task,
    mode: job.request.mode,
    cwd: job.request.cwd,
    timeoutSeconds: job.request.timeoutSeconds,
    profiles: job.request.profiles,
    error: job.error,
    latestUpdateText: job.latestUpdateText,
    latestUpdateDetails: job.latestUpdateDetails,
    historyLength: job.history.length,
  };
}

function updatePersistedJob(id: string, status: "cancelled" | "failed", latestLine: string): void {
  const db = SqliteDatabase.readwrite(database_filename);
  try {
    new SubagentDao(db).initializeSchema().finishRun(id, status, {latestLine, error: status === "failed" ? latestLine : null});
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
      profiles: request.profiles,
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
    if (text) job.latestUpdateText = text;
    job.latestUpdateDetails = partial.details;
    onUpdate?.(partial);
  };

  void runSubagent(request, job.controller.signal, captureUpdate)
    .then((result) => {
      if (job.status === subagentJobStatuses.cancelled) return;
      job.result = result;
      job.history.push({task, output: result.output});
      job.status = result.exitCode === 0 && !result.timedOut
        ? request.mode === subagentRunModes.conversation ? subagentJobStatuses.idle : subagentJobStatuses.completed
        : subagentJobStatuses.failed;
      job.finishedAt = job.status === subagentJobStatuses.idle ? undefined : Date.now();
    })
    .catch((error) => {
      if (job.status === subagentJobStatuses.cancelled) return;
      job.status = subagentJobStatuses.failed;
      job.error = error instanceof Error ? error.message : String(error);
      job.finishedAt = Date.now();
      updatePersistedJob(job.id, subagentJobStatuses.failed, job.error);
    });
}

function latestStatusText(job: AsyncSubagentJob): string | undefined {
  if (job.latestUpdateText) return lastMeaningfulLine(job.latestUpdateText);
  if (job.error) return job.error;
  if (job.result?.output) return lastMeaningfulLine(job.result.output);
  return undefined;
}

function lastMeaningfulLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? text.trim();
}

function shorten(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}
