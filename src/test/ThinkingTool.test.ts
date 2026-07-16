import assert from "node:assert/strict";
import {
  CommandDefinition,
  ExtensionContext,
  PiExtensionApi,
  SessionStartEvent,
  ToolDefinition,
} from "../pi/types";
import {
  registerThinkingTool,
  thinkingCommandCompletions,
  ThinkingMode,
} from "../extensions/tools/thinking";
import {ToolName} from "../shared/toolNames";

test("thinking tool accepts thoughts without echoing them and explicitly guides the agent", async () => {
  let tool: ToolDefinition | undefined;
  const pi = {
    on() {},
    registerTool(definition: ToolDefinition) { tool = definition; },
    registerCommand() {},
  } as PiExtensionApi;

  registerThinkingTool(pi);

  assert.equal(tool?.name, ToolName.thinking);
  const guidance = tool?.promptGuidelines?.join("\n") ?? "";
  assert.match(guidance, /Use thinking to expose internal reasoning when it would help the user/);
  assert.match(guidance, /inspect or correct assumptions, decisions, or changes in direction/);
  assert.match(guidance, /internal thoughts verbatim when available and permitted/);
  assert.match(guidance, /Paraphrase or summarize only when instructions or system limitations prevent verbatim disclosure/);
  assert.match(guidance, /multiple short lines rather than one long paragraph/);
  assert.match(guidance, /within the TUI width/);
  assert.match(guidance, /roughly 160 characters/);
  const result = await tool?.execute("thinking-1", {thoughts: "Check the invariant first."});
  assert.equal(result?.content[0]?.type, "text");
  assert.equal((result?.content[0] as {text?: string})?.text, "");
});

test("thinking tool folds calls from the tail", () => {
  let tool: ToolDefinition | undefined;
  const pi = {
    on() {},
    registerTool(definition: ToolDefinition) { tool = definition; },
    registerCommand() {},
  } as PiExtensionApi;
  registerThinkingTool(pi);

  const thoughts = Array.from({length: 12}, (_, index) => `thought ${index + 1}`).join("\n");
  const collapsedContext = {expanded: false} as never;
  const collapsedCall = tool?.renderCall?.({thoughts}, undefined as never, collapsedContext).render(120) ?? [];
  assert.doesNotMatch(collapsedCall.join("\n"), /thought 1(?:\n|$)/);
  assert.match(collapsedCall.join("\n"), /earlier lines/);
  assert.match(collapsedCall.join("\n"), /thought 12/);

  const expandedCall = tool?.renderCall?.({thoughts}, undefined as never, {expanded: true} as never).render(120) ?? [];
  assert.match(expandedCall.join("\n"), /thought 1/);
});

test("thinking tool defaults on only when the session starts with an OpenAI Codex model", () => {
  type SessionStartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => void;

  let sessionStartHandler: SessionStartHandler | undefined;
  let activeTools = ["read", ToolName.thinking];
  const pi = {
    on(event: string, handler: unknown) {
      if (event === "session_start") sessionStartHandler = handler as SessionStartHandler;
    },
    registerTool() {},
    registerCommand() {},
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => { activeTools = names; },
  } as PiExtensionApi;

  registerThinkingTool(pi);

  sessionStartHandler?.(
    {type: "session_start", reason: "startup"},
    {cwd: process.cwd(), model: {provider: "anthropic", id: "claude-sonnet"}},
  );
  assert.deepEqual(activeTools, ["read"]);

  sessionStartHandler?.(
    {type: "session_start", reason: "startup"},
    {cwd: process.cwd(), model: {provider: "openai-codex", id: "gpt-codex"}},
  );
  assert.deepEqual(activeTools, ["read", ToolName.thinking]);
});

test("thinking tool nudges at most once per user input when internal thinking was not shared", () => {
  type EventHandler = (event: Record<string, unknown>, ctx: ExtensionContext) => void;

  const handlers = new Map<string, EventHandler>();
  const sentMessages: Array<{message: Record<string, unknown>; options?: Record<string, unknown>}> = [];
  let activeTools = ["read", ToolName.thinking];
  const pi = {
    on(event: string, handler: unknown) { handlers.set(event, handler as EventHandler); },
    registerTool() {},
    registerCommand() {},
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => { activeTools = names; },
    sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>) {
      sentMessages.push({message, options});
    },
  } as unknown as PiExtensionApi;
  const ctx = {cwd: process.cwd()};
  const emit = (name: string, event: Record<string, unknown>) => handlers.get(name)?.(event, ctx);

  const completeThinkingTurn = (turnIndex: number, content: Array<Record<string, unknown>>) => {
    emit("turn_start", {type: "turn_start", turnIndex, timestamp: Date.now()});
    emit("message_update", {
      type: "message_update",
      message: {role: "assistant", content: []},
      assistantMessageEvent: {type: "thinking_end"},
    });
    emit("turn_end", {
      type: "turn_end",
      turnIndex,
      message: {role: "assistant", content},
      toolResults: [],
    });
  };

  registerThinkingTool(pi);
  emit("input", {type: "input", text: "Do work", source: "interactive"});
  completeThinkingTurn(0, [{
    type: "toolCall",
    id: "thinking-1",
    name: ToolName.thinking,
    arguments: {thoughts: "Verbatim thoughts"},
  }]);
  completeThinkingTurn(1, [{type: "text", text: "Done"}]);
  assert.equal(sentMessages.length, 0);

  emit("input", {type: "input", text: "Do more work", source: "interactive"});
  completeThinkingTurn(0, [{type: "text", text: "Done"}]);
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0].options, {deliverAs: "steer", triggerTurn: true});
  assert.equal(sentMessages[0].message.display, false);
  assert.match(String(sentMessages[0].message.content), /help the user inspect or correct assumptions/);
  assert.match(String(sentMessages[0].message.content), /internal thoughts verbatim when available and permitted/);

  emit("agent_start", {type: "agent_start"});
  completeThinkingTurn(1, [{type: "text", text: "Still done"}]);
  assert.equal(sentMessages.length, 1);

  activeTools = ["read"];
  emit("input", {type: "input", text: "Do work without thinking", source: "interactive"});
  completeThinkingTurn(0, [{type: "text", text: "Done"}]);
  assert.equal(sentMessages.length, 1);
});

test("thinking command turns only the thinking tool on and off", () => {
  let command: CommandDefinition | undefined;
  let activeTools = ["read", ToolName.thinking];
  const notifications: string[] = [];
  const pi = {
    on() {},
    registerTool() {},
    registerCommand(_name: string, definition: CommandDefinition) { command = definition; },
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => { activeTools = names; },
  } as PiExtensionApi;
  const ctx = {cwd: process.cwd(), ui: {notify: (message: string) => notifications.push(message)}} as never;

  registerThinkingTool(pi);
  command?.handler("", ctx);
  assert.deepEqual(activeTools, ["read"]);
  command?.handler("", ctx);
  assert.deepEqual(activeTools, ["read", ToolName.thinking]);

  command?.handler(ThinkingMode.OFF, ctx);
  assert.deepEqual(activeTools, ["read"]);
  command?.handler(ThinkingMode.ON, ctx);
  command?.handler(ThinkingMode.ON, ctx);
  assert.deepEqual(activeTools, ["read", ToolName.thinking]);
  assert.deepEqual(notifications, [
    "Thinking tool: off",
    "Thinking tool: on",
    "Thinking tool: off",
    "Thinking tool: on",
    "Thinking tool: on",
  ]);
});

test("thinking command rejects unsupported modes and completes enum values", () => {
  let command: CommandDefinition | undefined;
  let changed = false;
  const notifications: string[] = [];
  const pi = {
    on() {},
    registerTool() {},
    registerCommand(_name: string, definition: CommandDefinition) { command = definition; },
    getActiveTools: () => ["read"],
    setActiveTools: () => { changed = true; },
  } as PiExtensionApi;
  const ctx = {cwd: process.cwd(), ui: {notify: (message: string) => notifications.push(message)}} as never;

  registerThinkingTool(pi);
  command?.handler("maybe", ctx);

  assert.equal(changed, false);
  assert.deepEqual(notifications, ["Usage: /thinking [on|off]"]);
  assert.deepEqual(thinkingCommandCompletions("o")?.map((item) => item.value), [ThinkingMode.ON, ThinkingMode.OFF]);
  assert.equal(thinkingCommandCompletions("x"), null);
});
