import {readSubagentTreeContext, nextChildId, nextRootSubagentId} from "./tree-ui";
import {runSubagent, SubagentRequest, SubagentResult} from "./runner";

export type AsyncSubagentJob = {
  id: string;
  request: SubagentRequest;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  controller: AbortController;
  result?: SubagentResult;
  error?: string;
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
    status: "running",
    startedAt: Date.now(),
    controller,
  };
  asyncJobs.set(id, job);

  void runSubagent(request, controller.signal)
    .then((result) => {
      if (job.status === "cancelled") return;
      job.result = result;
      job.status = result.exitCode === 0 && !result.timedOut ? "completed" : "failed";
      job.finishedAt = Date.now();
    })
    .catch((error) => {
      if (job.status === "cancelled") return;
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.finishedAt = Date.now();
    });

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

export function cancelAsyncSubagentJob(job: AsyncSubagentJob): void {
  if (job.status !== "running") return;
  job.status = "cancelled";
  job.finishedAt = Date.now();
  job.controller.abort();
}

export async function waitForJobs(
  jobs: AsyncSubagentJob[],
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(1, timeoutSeconds) * 1000;

  while (jobs.some((job) => job.status === "running")) {
    if (signal?.aborted || Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return true;
}

export function unfinishedJobIds(jobs: AsyncSubagentJob[]): string[] {
  return jobs.filter((job) => job.status === "running").map((job) => job.id);
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
  };
}
