import {AutocompleteItem, PiExtensionApi} from "../../../pi/types";
import {renderBlockToolCall} from "../../../shared/blockToolRendering";
import {toolNames} from "../../../shared/toolNames";
import {FoldDirection} from "../../../shared/toolRendering";
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
      "After reasoning internally, always call thinking before any answer or other tool. Share the closest precise account of that reasoning you can provide; if instructions limit disclosure, paraphrase or summarize while preserving the key considerations and decisions.",
      "Format thinking as multiple short lines rather than one long paragraph. Keep each line within the TUI width; when that width is unknown, wrap at roughly 160 characters.",
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
      return successResult("");
    },
    renderCall(args, theme, context) {
      const thoughts = (args as {thoughts?: unknown}).thoughts;
      return renderBlockToolCall({
        title: toolNames.thinking,
        block: {label: "thoughts", text: typeof thoughts === "string" ? thoughts : ""},
        fold: {direction: FoldDirection.TAIL},
      }, theme, context);
    },
  });

  pi.registerCommand?.("thinking", {
    description: "Toggle the thinking tool, or explicitly turn it on or off: /thinking [on|off]",
    getArgumentCompletions: thinkingCommandCompletions,
    handler(args, ctx) {
      const mode = args.trim().toLowerCase();
      let enabled: boolean;
      if (!mode) {
        const current = isThinkingToolEnabled(pi);
        if (current === undefined) {
          ctx.ui?.notify?.("This Pi runtime does not support inspecting active tools.", "error");
          return;
        }
        enabled = !current;
      } else if (mode === ThinkingMode.ON || mode === ThinkingMode.OFF) {
        enabled = mode === ThinkingMode.ON;
      } else {
        ctx.ui?.notify?.("Usage: /thinking [on|off]", "error");
        return;
      }

      if (!setThinkingToolEnabled(pi, enabled)) {
        ctx.ui?.notify?.("This Pi runtime does not support changing active tools.", "error");
        return;
      }
      ctx.ui?.notify?.(`Thinking tool: ${enabled ? ThinkingMode.ON : ThinkingMode.OFF}`, "info");
    },
  });
}

export function isThinkingToolEnabled(pi: PiExtensionApi): boolean | undefined {
  return pi.getActiveTools?.().includes(toolNames.thinking);
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
