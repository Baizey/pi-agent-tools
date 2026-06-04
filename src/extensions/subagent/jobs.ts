import {readSubagentTreeContext, nextChildId, nextRootSubagentId} from "./tree-ui";
import {subagentRunModes} from "./profiles";
import {runSubagent, SubagentRequest, SubagentResult} from "./runner";

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
  history: Array<{task: string; output: string}>;
};

const asyncJobs = new Map<string, AsyncSubagentJob>();

export function startAsyncSubagentJob(request: SubagentRequest): AsyncSubagentJob {
  const context = readSubagentTreeContext();
  const id = context.nodeId ? nextChildId(context.nodeId) : nextRootSubagentId();
  request.treeNodeId = id;
  request.treeParentId = context.nodeId;
  request.treeRootId = context.rootId ?? id;
  request.treeDepth = context.nodeId ? context.depth + 1 : 0;
  const controller = new AbortController();
  const job: AsyncSubagentJob = {
    id,
    request,
    status: subagentJobStatuses.running,
    startedAt: Date.now(),
    controller,
    history: [],
  };
  asyncJobs.set(id, job);

  runJob(job, request, request.task);
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

export function sendConversationMessage(job: AsyncSubagentJob, task: string): void {
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
  runJob(job, request, task);
}

export function cancelAsyncSubagentJob(job: AsyncSubagentJob): void {
  if (job.status !== subagentJobStatuses.running && job.status !== subagentJobStatuses.idle) return;
  job.status = subagentJobStatuses.cancelled;
  job.finishedAt = Date.now();
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
    historyLength: job.history.length,
  };
}

function runJob(job: AsyncSubagentJob, request: SubagentRequest, task: string): void {
  void runSubagent(request, job.controller.signal)
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
    });
}
