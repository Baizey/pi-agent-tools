import {AutocompleteItem, PiExtensionApi} from "../../../pi/types";
import {renderBlockToolCall} from "../../../shared/blockToolRendering";
import {ToolName} from "../../../shared/toolNames";
import {FoldDirection} from "../../../shared/toolRendering";
import {successResult} from "../../../shared/toolResults";

export enum ThinkingMode {
  ON = "on",
  OFF = "off",
}

const THINKING_REMINDER_TYPE = "thinking-reminder";
const THINKING_REMINDER = "You completed internal reasoning without sharing it through the thinking tool. When exposing that reasoning would help the user inspect or correct assumptions, consider calling thinking. Prefer those internal thoughts verbatim when available and permitted; paraphrase or summarize only when instructions or system limitations prevent verbatim disclosure.";

export function registerThinkingTool(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: ToolName.thinking,
    label: "Thinking",
    description: "Share thoughts or reasoning before continuing with the task.",
    promptSnippet: "Share thoughts or reasoning",
    promptGuidelines: [
      "Use thinking to expose internal reasoning when it would help the user inspect or correct assumptions, decisions, or changes in direction. Prefer those internal thoughts verbatim when available and permitted. Paraphrase or summarize only when instructions or system limitations prevent verbatim disclosure.",
      "Format thinking as multiple short lines rather than one long paragraph. Keep each line within the TUI width; when that width is unknown, wrap at roughly 160 characters.",
    ],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["thoughts"],
      properties: {
        thoughts: {
          type: "string",
          description: "The thoughts or reasoning to share.",
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
        title: ToolName.thinking,
        block: {label: "thoughts", text: typeof thoughts === "string" ? thoughts : ""},
        fold: {direction: FoldDirection.TAIL},
      }, theme, context);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    setThinkingToolEnabled(pi, ctx.model?.provider === "openai-codex");
  });
  registerThinkingReminder(pi);

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

function registerThinkingReminder(pi: PiExtensionApi): void {
  let thinkingCompletedThisTurn = false;
  let thinkingHandledForCurrentInput = false;

  pi.on("input", (event) => {
    if (event.source === "extension") return;
    thinkingCompletedThisTurn = false;
    thinkingHandledForCurrentInput = false;
  });
  pi.on("turn_start", () => {
    thinkingCompletedThisTurn = false;
  });
  pi.on("message_update", (event) => {
    if (isThinkingEndEvent(event.assistantMessageEvent)) thinkingCompletedThisTurn = true;
  });
  pi.on("turn_end", (event) => {
    const shouldConsiderReminder = thinkingCompletedThisTurn;
    thinkingCompletedThisTurn = false;
    if (messageCallsThinkingTool(event.message)) {
      thinkingHandledForCurrentInput = true;
      return;
    }
    if (
      !shouldConsiderReminder
      || thinkingHandledForCurrentInput
      || isThinkingToolEnabled(pi) !== true
      || !pi.sendMessage
    ) return;

    thinkingHandledForCurrentInput = true;
    pi.sendMessage({
      customType: THINKING_REMINDER_TYPE,
      content: THINKING_REMINDER,
      display: false,
    }, {deliverAs: "steer", triggerTurn: true});
  });
}

function isThinkingEndEvent(event: unknown): boolean {
  return typeof event === "object" && event !== null && "type" in event && event.type === "thinking_end";
}

function messageCallsThinkingTool(message: {content?: unknown}): boolean {
  return Array.isArray(message.content) && message.content.some((part) => (
    typeof part === "object"
    && part !== null
    && "type" in part
    && part.type === "toolCall"
    && "name" in part
    && part.name === ToolName.thinking
  ));
}

export function isThinkingToolEnabled(pi: PiExtensionApi): boolean | undefined {
  return pi.getActiveTools?.().includes(ToolName.thinking);
}

export function setThinkingToolEnabled(pi: PiExtensionApi, enabled: boolean): boolean {
  const activeTools = pi.getActiveTools?.();
  if (!activeTools || !pi.setActiveTools) return false;

  let next = activeTools;
  if (enabled && !activeTools.includes(ToolName.thinking)) next = [...activeTools, ToolName.thinking];
  if (!enabled) next = activeTools.filter((name) => name !== ToolName.thinking);
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
