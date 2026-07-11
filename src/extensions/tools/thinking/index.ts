import {AutocompleteItem, PiExtensionApi} from "../../../pi/types";
import {toolNames} from "../../../shared/toolNames";
import {successResult} from "../../../shared/toolResults";

export enum ThinkingMode {
  ON = "on",
  OFF = "off",
}

export function registerThinkingTool(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: toolNames.thinking,
    label: "Thinking",
    description: "Share concise thoughts or reasoning before continuing with the task.",
    promptSnippet: "Share concise thoughts or reasoning",
    promptGuidelines: [
      "When the thinking tool is active, output your thoughts through thinking before continuing with your answer or other tools.",
    ],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["thoughts"],
      properties: {
        thoughts: {
          type: "string",
          description: "The concise thoughts or reasoning to share.",
        },
      },
    },
    async execute(_toolCallId, params) {
      const thoughts = (params as {thoughts?: unknown}).thoughts;
      if (typeof thoughts !== "string") throw new Error("thinking requires a thoughts string.");
      return successResult(thoughts);
    },
  });

  pi.registerCommand?.("thinking", {
    description: "Turn the thinking tool on or off: /thinking <on|off>",
    getArgumentCompletions: thinkingCommandCompletions,
    handler(args, ctx) {
      const mode = args.trim().toLowerCase();
      if (mode !== ThinkingMode.ON && mode !== ThinkingMode.OFF) {
        ctx.ui?.notify?.("Usage: /thinking <on|off>", "error");
        return;
      }

      if (!setThinkingToolEnabled(pi, mode === ThinkingMode.ON)) {
        ctx.ui?.notify?.("This Pi runtime does not support changing active tools.", "error");
        return;
      }
      ctx.ui?.notify?.(`Thinking tool: ${mode}`, "info");
    },
  });
}

export function setThinkingToolEnabled(pi: PiExtensionApi, enabled: boolean): boolean {
  const activeTools = pi.getActiveTools?.();
  if (!activeTools || !pi.setActiveTools) return false;

  let next = activeTools;
  if (enabled && !activeTools.includes(toolNames.thinking)) next = [...activeTools, toolNames.thinking];
  if (!enabled) next = activeTools.filter((name) => name !== toolNames.thinking);
  pi.setActiveTools(next);
  return true;
}

export function thinkingCommandCompletions(prefix: string): AutocompleteItem[] | null {
  const normalized = prefix.trim().toLowerCase();
  const items = Object.values(ThinkingMode)
    .filter((mode) => mode.startsWith(normalized))
    .map((mode) => ({value: mode, label: mode}));
  return items.length > 0 ? items : null;
}
