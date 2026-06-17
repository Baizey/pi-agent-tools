export type ExtensionMode = "tui" | "rpc" | "json" | "print";

export type TextContent = {type: "text"; text: string};
export type ImageContent = {type: "image"; data: string; mimeType: string};
export type ThinkingContent = {type: "thinking"; thinking: string};
export type ToolCallContent = {type: "toolCall"; id: string; name: string; arguments: Record<string, unknown>};

export type AgentMessage = Record<string, unknown> & {
  role: string;
  timestamp?: number;
};

export type SessionEntryBase = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
};

export type SessionHeader = {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
};

export type SessionMessageEntry = SessionEntryBase & {
  type: "message";
  message: AgentMessage;
};

export type SessionEntry = SessionEntryBase & Record<string, unknown>;

export type SessionTreeNode = {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
  labelTimestamp?: string;
};

export type ReadonlySessionManager = {
  getCwd(): string;
  getSessionDir(): string;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getLeafId(): string | null;
  getLeafEntry(): SessionEntry | undefined;
  getEntry(id: string): SessionEntry | undefined;
  getLabel(id: string): string | undefined;
  getBranch(fromId?: string): SessionEntry[];
  getHeader(): SessionHeader;
  getEntries(): SessionEntry[];
  getTree(): SessionTreeNode[];
  getSessionName(): string | undefined;
};

export type PiExtensionApi = {
  on(event: "project_trust", handler: ExtensionHandler<ProjectTrustEvent, ProjectTrustDecision>): void;
  on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
  on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
  on(event: "session_before_switch", handler: ExtensionHandler<SessionBeforeSwitchEvent, CancelDecision>): void;
  on(event: "session_before_fork", handler: ExtensionHandler<SessionBeforeForkEvent, CancelDecision | {skipConversationRestore?: boolean}>): void;
  on(event: "session_before_compact", handler: ExtensionHandler<SessionBeforeCompactEvent, CancelDecision | Record<string, unknown>>): void;
  on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
  on(event: "session_before_tree", handler: ExtensionHandler<SessionBeforeTreeEvent, CancelDecision | Record<string, unknown>>): void;
  on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
  on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartDecision>): void;
  on(event: "agent_start", handler: ExtensionHandler<AgentStartEvent>): void;
  on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): void;
  on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
  on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent>): void;
  on(event: "message_start", handler: ExtensionHandler<MessageEvent>): void;
  on(event: "message_update", handler: ExtensionHandler<MessageUpdateEvent>): void;
  on(event: "message_end", handler: ExtensionHandler<MessageEvent, MessageEndDecision>): void;
  on(event: "context", handler: ExtensionHandler<ContextEvent, ContextDecision>): void;
  on(event: "before_provider_request", handler: ExtensionHandler<BeforeProviderRequestEvent, unknown>): void;
  on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallDecision>): void;
  on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, Partial<ToolResult>>): void;
  on(event: "tool_execution_start", handler: ExtensionHandler<ToolExecutionEvent>): void;
  on(event: "tool_execution_update", handler: ExtensionHandler<ToolExecutionUpdateEvent>): void;
  on(event: "tool_execution_end", handler: ExtensionHandler<ToolExecutionEndEvent>): void;
  on(event: "user_bash", handler: ExtensionHandler<UserBashEvent, UserBashDecision>): void;
  on(event: string, handler: ExtensionHandler<Record<string, unknown>, unknown>): void;
  registerTool?(definition: ToolDefinition): void;
};

export type ExtensionHandler<TEvent, TResult = void> = (
  event: TEvent,
  ctx: ExtensionContext,
) => Promise<TResult | void> | TResult | void;

export type ProjectTrustEvent = {
  cwd: string;
};

export type ProjectTrustDecision = {
  trusted: "yes" | "no" | "undecided";
  remember?: boolean;
};

export type ProjectTrustContext = Pick<ExtensionContext, "cwd" | "hasUI" | "ui"> & {
  mode?: ExtensionMode | string;
};

export type SessionStartEvent = {
  reason: "startup" | "reload" | "new" | "resume" | "fork" | string;
  previousSessionFile?: string;
};

export type SessionShutdownEvent = {
  reason: "quit" | "reload" | "new" | "resume" | "fork" | string;
  targetSessionFile?: string;
};

export type SessionBeforeSwitchEvent = {
  reason: "new" | "resume" | string;
  targetSessionFile?: string;
};

export type SessionBeforeForkEvent = {
  entryId: string;
  position: "before" | "at";
};

export type SessionBeforeCompactEvent = Record<string, unknown>;
export type SessionCompactEvent = {compactionEntry: SessionEntry; fromExtension?: boolean};
export type SessionBeforeTreeEvent = Record<string, unknown>;
export type SessionTreeEvent = {newLeafId: string | null; oldLeafId: string | null; summaryEntry?: SessionEntry; fromExtension?: boolean};

export type CancelDecision = {
  cancel: true;
};

export type ToolCallEvent = {
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
};

export type ToolCallDecision = {
  block: true;
  reason: string;
};

export type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: ExtensionContext,
  ): Promise<ToolResult & {terminate?: boolean}>;
  prepareArguments?(args: unknown): unknown;
  renderCall?(args: Record<string, unknown>, theme?: unknown, context?: unknown): unknown;
  renderResult?(result: ToolResult, state?: {expanded?: boolean; isPartial?: boolean}, theme?: unknown, context?: unknown): unknown;
};

export type ToolResult = {
  content: Array<TextContent>;
  details?: Record<string, unknown>;
  isError?: boolean;
};

export type ToolResultEvent = {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  isError?: boolean;
};

export type ToolExecutionEvent = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type ToolExecutionUpdateEvent = ToolExecutionEvent & {
  partialResult?: unknown;
};

export type ToolExecutionEndEvent = ToolExecutionEvent & {
  result: ToolResult;
  isError?: boolean;
};

export type UserBashEvent = {
  command: string;
  cwd: string;
  excludeFromContext: boolean;
};

export type UserBashDecision = {
  result: {
    output: string;
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
  };
};

export type BeforeAgentStartEvent = {
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string;
  systemPromptOptions?: {
    customPrompt?: string;
    selectedTools?: Array<string | {name?: string}>;
    toolSnippets?: string[];
    promptGuidelines?: string[];
    appendSystemPrompt?: string[];
    cwd?: string;
    contextFiles?: Array<{path: string; content?: string}>;
    skills?: Array<Record<string, unknown>>;
  };
};

export type BeforeAgentStartDecision = {
  systemPrompt?: string;
  message?: Record<string, unknown>;
};

export type AgentStartEvent = Record<string, unknown>;

export type AgentEndEvent = {
  messages: AgentMessage[];
};

export type TurnStartEvent = {
  turnIndex: number;
  timestamp: number;
};

export type TurnEndEvent = {
  turnIndex: number;
  message?: AgentMessage;
  toolResults?: ToolResult[];
};

export type MessageEvent = {
  message: AgentMessage;
};

export type MessageUpdateEvent = MessageEvent & {
  assistantMessageEvent?: unknown;
};

export type MessageEndDecision = {
  message: AgentMessage;
};

export type ContextEvent = {
  messages: AgentMessage[];
};

export type ContextDecision = {
  messages: AgentMessage[];
};

export type BeforeProviderRequestEvent = {
  payload: unknown;
};

export type ExtensionContext = {
  cwd: string;
  mode?: ExtensionMode;
  signal?: AbortSignal;
  sessionManager?: ReadonlySessionManager;
  model?: Record<string, unknown>;
  modelRegistry?: {
    getAvailable(): Promise<Array<{
      provider: string;
      id: string;
      name?: string;
      input?: string[];
      reasoning?: boolean;
      cost?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
    }>>;
  };
  hasUI?: boolean;
  ui?: ExtensionUIContext;
  isIdle?(): boolean;
  isProjectTrusted?(): boolean;
  abort?(): void;
  hasPendingMessages?(): boolean;
  shutdown?(): void;
  getContextUsage?(): {tokens: number; percent?: number; cost?: number};
  compact?(options?: Record<string, unknown>): void;
  getSystemPrompt?(): string;
};

export type ExtensionUIContext = {
  select(title: string, items: string[]): Promise<string | undefined>;
  input?(title: string, placeholder?: string): Promise<string | undefined>;
  confirm?(title: string, message?: string): Promise<boolean>;
  notify?(message: string, level?: "info" | "warning" | "error" | string): void;
  setStatus?(key: string, value: string): void;
  setWidget?(key: string, lines: string[]): void;
  setTitle?(title: string): void;
  setEditorText?(text: string): void;
};
