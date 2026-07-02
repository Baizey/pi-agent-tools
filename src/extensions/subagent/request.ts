import {agentEnv} from "../../shared/env";
import {stringValue} from "../../shared/values";
import {
  applySubagentToolkitCeiling,
  defaultTimeoutSecondsForMode,
  normalizeSubagentToolkits,
  parseSubagentToolkitCeiling,
  SubagentRunMode,
  subagentRunModes,
} from "./toolkits";
import {SubagentRequest} from "./runner";

export type RawSubagentParams = Record<string, unknown> & {
  mode?: unknown;
  task?: unknown;
  toolkits?: unknown;
  cwd?: unknown;
  timeoutSeconds?: unknown;
  model?: unknown;
  systemPrompt?: unknown;
  contextPaths?: unknown;
};

export type RawJobParams = Record<string, unknown> & {
  jobId?: unknown;
  jobIds?: unknown;
  timeoutSeconds?: unknown;
};

export function parseSubagentRequest(params: RawSubagentParams, defaultCwd: string): SubagentRequest | {error: string} {
  const mode = normalizeMode(params.mode);
  const task = stringValue(params.task);
  if (!task) return {error: "Missing required parameter: task."};

  const requestedToolkits = normalizeSubagentToolkits(params.toolkits);
  const ceilingToolkits = parseSubagentToolkitCeiling(process.env[agentEnv.subagentToolkitCeiling]);

  return {
    mode,
    task,
    toolkits: applySubagentToolkitCeiling(requestedToolkits, ceilingToolkits),
    cwd: stringValue(params.cwd) ?? defaultCwd,
    timeoutSeconds: normalizeTimeout(params.timeoutSeconds, defaultTimeoutSecondsForMode(mode)),
    model: (stringValue(params.model) ?? process.env[agentEnv.subagentModel]?.trim()) || undefined,
    systemPrompt: stringValue(params.systemPrompt) ?? undefined,
    contextPaths: normalizeContextPaths(params.contextPaths),
  };
}

export function normalizeMode(value: unknown): SubagentRunMode {
  if (value === subagentRunModes.async || value === subagentRunModes.conversation) return value;
  return subagentRunModes.sync;
}

export function normalizeTimeout(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, 3600) : fallback;
}

export function normalizeContextPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const paths = value.filter((it): it is string => typeof it === "string" && it.trim().length > 0);
  return paths.length > 0 ? paths : undefined;
}

export function normalizeJobIds(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((it): it is string => typeof it === "string" && it.trim().length > 0);
}
