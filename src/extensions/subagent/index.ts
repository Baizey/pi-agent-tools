import {PiExtensionApi} from "../../pi/types";
import {stringValue} from "../../shared/values";
import {defaultTimeoutSecondsForMode, normalizeSubagentProfiles, SubagentRunMode} from "./profiles";
import {runSyncSubagent} from "./runner";

type SubagentParams = {
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
    name: "subagent",
    label: "Subagent",
    description: "Run a scoped subagent. Sync mode is implemented now; async and conversation modes are reserved.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: {
        mode: {
          type: "string",
          enum: ["sync", "async", "conversation"],
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
            enum: [
              "summary_only",
              "read_only",
              "io",
              "bash",
              "execute",
              "web",
              "subagent",
            ],
          },
          description: "Capability profiles. Defaults to [read_only]. Profiles are additive.",
        },
        cwd: {
          type: "string",
          description: "Working directory for the subagent. Defaults to current cwd.",
        },
        timeoutSeconds: {
          type: "number",
          description: "Timeout for sync run. Defaults based on mode.",
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
      const input = params as SubagentParams;
      const mode = normalizeMode(input.mode);
      const task = stringValue(input.task);
      if (!task) return errorResult("Missing required parameter: task.");

      const timeoutSeconds = normalizeTimeout(input.timeoutSeconds, defaultTimeoutSecondsForMode(mode));
      const profiles = normalizeSubagentProfiles(input.profiles);
      const cwd = stringValue(input.cwd) ?? ctx?.cwd ?? process.cwd();
      const systemPrompt = stringValue(input.systemPrompt) ?? undefined;
      const contextPaths = Array.isArray(input.contextPaths)
        ? input.contextPaths.filter((it): it is string => typeof it === "string" && it.trim().length > 0)
        : undefined;

      if (mode !== "sync") {
        return errorResult(`Subagent mode '${mode}' is planned but not implemented yet. Use mode 'sync'.`, {
          mode,
          timeoutSeconds,
          profiles,
        });
      }

      const result = await runSyncSubagent({task, profiles, cwd, timeoutSeconds, systemPrompt, contextPaths}, signal);
      const isError = result.exitCode !== 0 || result.timedOut;
      return {
        content: [{type: "text" as const, text: result.timedOut ? `Subagent timed out.\n${result.output}` : result.output}],
        details: {
          mode,
          task,
          cwd,
          timeoutSeconds,
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
  });
}

function normalizeMode(value: unknown): SubagentRunMode {
  if (value === "async" || value === "conversation") return value;
  return "sync";
}

function normalizeTimeout(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, 3600) : fallback;
}

function errorResult(message: string, details: Record<string, unknown> = {}) {
  return {
    content: [{type: "text" as const, text: message}],
    details: {...details, error: true},
    isError: true,
  };
}

export {runSyncSubagent} from "./runner";
export * from "./profiles";
