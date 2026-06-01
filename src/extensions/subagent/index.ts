import {PiExtensionApi} from "../../pi/types";
import {agentEnv} from "../../shared/env";
import {toolNames} from "../../shared/toolNames";
import {renderToolCallInput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";
import {
  applySubagentProfileCeiling,
  defaultTimeoutSecondsForMode,
  normalizeSubagentProfiles,
  parseSubagentProfileCeiling,
  SubagentRunMode,
  subagentProfiles,
  subagentRunModes,
} from "./profiles";
import {runSubagent, SubagentRequest} from "./runner";

type RawSubagentParams = Record<string, unknown> & {
  mode?: unknown;
  task?: unknown;
  profiles?: unknown;
  cwd?: unknown;
  timeoutSeconds?: unknown;
  systemPrompt?: unknown;
  contextPaths?: unknown;
};

export function registerSubagentTool(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.subagent,
    label: "Subagent",
    description: "Run a scoped subagent. Sync mode is implemented now; async and conversation modes are reserved.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: {
        mode: {
          type: "string",
          enum: Object.values(subagentRunModes),
          description: "Run mode. Only sync is implemented currently. Defaults to sync.",
          default: "sync",
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
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const request = parseSubagentRequest(params as RawSubagentParams, ctx?.cwd ?? process.cwd());
      if ("error" in request) return errorResult(request.error);

      const result = await runSubagent(request, signal);
      const isError = result.exitCode !== 0 || result.timedOut;
      return {
        content: [{type: "text" as const, text: result.timedOut ? `Subagent timed out.\n${result.output}` : result.output}],
        details: {
          mode: result.mode,
          task: request.task,
          cwd: request.cwd,
          timeoutSeconds: request.timeoutSeconds,
          profiles: result.profiles.profiles,
          tools: result.profiles.tools,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stderr: result.stderr,
          messages: result.messages,
        },
        isError,
      };
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.subagent, args, theme as never);
    },
  });
}

function parseSubagentRequest(params: RawSubagentParams, defaultCwd: string): SubagentRequest | {error: string} {
  const mode = normalizeMode(params.mode);
  const task = stringValue(params.task);
  if (!task) return {error: "Missing required parameter: task."};

  const requestedProfiles = normalizeSubagentProfiles(params.profiles);
  const ceilingProfiles = parseSubagentProfileCeiling(process.env[agentEnv.subagentProfileCeiling]);

  return {
    mode,
    task,
    profiles: applySubagentProfileCeiling(requestedProfiles, ceilingProfiles),
    cwd: stringValue(params.cwd) ?? defaultCwd,
    timeoutSeconds: normalizeTimeout(params.timeoutSeconds, defaultTimeoutSecondsForMode(mode)),
    systemPrompt: stringValue(params.systemPrompt) ?? undefined,
    contextPaths: normalizeContextPaths(params.contextPaths),
  };
}

function normalizeMode(value: unknown): SubagentRunMode {
  if (value === subagentRunModes.async || value === subagentRunModes.conversation) return value;
  return subagentRunModes.sync;
}

function normalizeTimeout(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, 3600) : fallback;
}

function normalizeContextPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const paths = value.filter((it): it is string => typeof it === "string" && it.trim().length > 0);
  return paths.length > 0 ? paths : undefined;
}

function errorResult(message: string, details: Record<string, unknown> = {}) {
  return {
    content: [{type: "text" as const, text: message}],
    details: {...details, error: true},
    isError: true,
  };
}

export {runSubagent, runSyncSubagent} from "./runner";
export * from "./profiles";
