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
  assert.match(guidance, /always call thinking before any answer or other tool/);
  assert.match(guidance, /closest precise account/);
  assert.match(guidance, /paraphrase or summarize while preserving the key considerations and decisions/);
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
