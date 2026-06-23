// Structural copy of the public extension/session types exposed by
// @earendil-works/pi-coding-agent. Kept local so this package can compile
// without depending on pi internals at runtime.

export type ExtensionMode = "tui" | "rpc" | "json" | "print";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ToolExecutionMode = "sequential" | "parallel";

export type TextContent = {type: "text"; text: string};
export type ImageContent =
  | {type: "image"; data: string; mimeType: string}
  | {type: "image"; source: {type: "base64"; mediaType: string; data: string}};
export type ThinkingContent = {type: "thinking"; thinking: string};
export type ToolCallContent = {type: "toolCall"; id: string; name: string; arguments: Record<string, unknown>};
export type MessageContent = TextContent | ImageContent | ThinkingContent | ToolCallContent;

export type AgentMessage = Record<string, unknown> & {
  role: string;
  content?: string | MessageContent[];
  timestamp?: number;
};

export type AgentToolUpdateCallback<TDetails = unknown> = (partial: AgentToolResult<TDetails>) => void;
// Public pi-agent-core allows text and image tool result content. `details` is
// optional here because several tools in this package return text-only results.
export type AgentToolResult<TDetails = unknown> = {
  content: Array<TextContent | ImageContent>;
  details?: TDetails;
  isError?: boolean;
  terminate?: boolean;
};
export type ToolResult<TDetails = unknown> = AgentToolResult<TDetails>;
export type ToolResultMessage = Record<string, unknown> & {role: "toolResult"; content?: Array<TextContent | ImageContent>};

export type TSchema = Record<string, unknown>;
export type Static<T> = T extends {static: infer S} ? S : Record<string, unknown>;
export type Component = {render(width: number): string[]; handleInput?(data: string): void; wantsKeyRelease?: boolean; invalidate(): void};
export type TUI = Record<string, unknown>;
export type Theme = Record<string, unknown> & {
  fg?(color: string, text: string): string;
  bg?(color: string, text: string): string;
  bold?(text: string): string;
};
export type EditorTheme = Theme;
export type EditorComponent = Component;
export type KeyId = string;
export type KeybindingsManager = Record<string, unknown>;
export type OverlayOptions = Record<string, unknown>;
export type OverlayHandle = {focus(): void; unfocus(options?: {target?: Component | null}): void; setHidden(hidden: boolean): void; hide(): void};
export type AutocompleteItem = {value: string; label?: string; description?: string};
export type AutocompleteProvider = {
  triggerCharacters?: string[];
  getSuggestions(lines: string[], line: number, col: number, options?: unknown): Promise<{prefix: string; items: AutocompleteItem[]} | null> | {prefix: string; items: AutocompleteItem[]} | null;
  applyCompletion(lines: string[], line: number, col: number, item: AutocompleteItem, prefix: string): unknown;
  shouldTriggerFileCompletion?(lines: string[], line: number, col: number): boolean;
};
export type AutocompleteProviderFactory = (current: AutocompleteProvider) => AutocompleteProvider;
export type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;
export type EventBus = {on(event: string, handler: (...args: unknown[]) => void): () => void; emit(event: string, data?: unknown): void};

export type SourceInfo = {
  path: string;
  source: string;
  scope: "user" | "project" | "temporary" | string;
  origin: "package" | "top-level" | string;
  baseDir?: string;
};

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {type: "message"; message: AgentMessage}
export interface ThinkingLevelChangeEntry extends SessionEntryBase {type: "thinking_level_change"; thinkingLevel: string}
export interface ModelChangeEntry extends SessionEntryBase {type: "model_change"; provider: string; modelId: string}
export interface CompactionEntry<T = unknown> extends SessionEntryBase {type: "compaction"; summary: string; firstKeptEntryId: string; tokensBefore: number; details?: T; fromHook?: boolean}
export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {type: "branch_summary"; fromId: string; summary: string; details?: T; fromHook?: boolean}
export interface CustomEntry<T = unknown> extends SessionEntryBase {type: "custom"; customType: string; data?: T}
export interface LabelEntry extends SessionEntryBase {type: "label"; targetId: string; label: string | undefined}
export interface SessionInfoEntry extends SessionEntryBase {type: "session_info"; name?: string}
export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {type: "custom_message"; customType: string; content: string | (TextContent | ImageContent)[]; details?: T; display: boolean}
export type SessionEntry = SessionMessageEntry | ThinkingLevelChangeEntry | ModelChangeEntry | CompactionEntry | BranchSummaryEntry | CustomEntry | CustomMessageEntry | LabelEntry | SessionInfoEntry;

export interface SessionTreeNode {entry: SessionEntry; children: SessionTreeNode[]; label?: string; labelTimestamp?: string}
export interface SessionContext {messages: AgentMessage[]; thinkingLevel: string; model: {provider: string; modelId: string} | null}
export interface SessionInfo {path: string; id: string; cwd: string; name?: string; parentSessionPath?: string; created: Date; modified: Date; messageCount: number; firstMessage: string; allMessagesText: string}

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
  getHeader(): SessionHeader | null;
  getEntries(): SessionEntry[];
  getTree(): SessionTreeNode[];
  getSessionName(): string | undefined;
};

export type SessionManager = ReadonlySessionManager & {
  appendMessage(message: AgentMessage): string;
  appendThinkingLevelChange(thinkingLevel: string): string;
  appendModelChange(provider: string, modelId: string): string;
  appendCompaction<T = unknown>(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: T, fromHook?: boolean): string;
  appendCustomEntry(customType: string, data?: unknown): string;
  appendSessionInfo(name: string): string;
  appendCustomMessageEntry<T = unknown>(customType: string, content: string | (TextContent | ImageContent)[], display: boolean, details?: T): string;
  appendLabelChange(targetId: string, label: string | undefined): string;
  getChildren?(parentId: string): SessionEntry[];
  branch?(branchFromId: string): void;
  resetLeaf?(): void;
  branchWithSummary?(branchFromId: string | null, summary: string, details?: unknown, fromHook?: boolean): string;
  buildSessionContext?(): SessionContext;
};

export interface ExtensionUIDialogOptions {signal?: AbortSignal; timeout?: number}
export type WidgetPlacement = "aboveEditor" | "belowEditor";
export interface ExtensionWidgetOptions {placement?: WidgetPlacement}
export type TerminalInputHandler = (data: string) => {consume?: boolean; data?: string} | undefined;
export interface WorkingIndicatorOptions {frames?: string[]; intervalMs?: number}
export type ReadonlyFooterDataProvider = Record<string, unknown>;

// Some UI members are optional for non-TUI tests/mocks. Pi's public
// ExtensionUIContext provides the full set at runtime (or no-op mode impls).
export interface ExtensionUIContext {
  select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  onTerminalInput?(handler: TerminalInputHandler): () => void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage?(message?: string): void;
  setWorkingVisible?(visible: boolean): void;
  setWorkingIndicator?(options?: WorkingIndicatorOptions): void;
  setHiddenThinkingLabel?(label?: string): void;
  setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;
  setWidget(key: string, content: ((tui: TUI, theme: Theme) => Component & {dispose?(): void}) | undefined, options?: ExtensionWidgetOptions): void;
  setFooter?(factory: ((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & {dispose?(): void}) | undefined): void;
  setHeader?(factory: ((tui: TUI, theme: Theme) => Component & {dispose?(): void}) | undefined): void;
  setTitle(title: string): void;
  custom?<T>(factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => (Component & {dispose?(): void}) | Promise<Component & {dispose?(): void}>, options?: {overlay?: boolean; overlayOptions?: OverlayOptions | (() => OverlayOptions); onHandle?: (handle: OverlayHandle) => void}): Promise<T>;
  pasteToEditor?(text: string): void;
  setEditorText(text: string): void;
  getEditorText?(): string;
  editor?(title: string, prefill?: string): Promise<string | undefined>;
  addAutocompleteProvider?(factory: AutocompleteProviderFactory): void;
  setEditorComponent?(factory: EditorFactory | undefined): void;
  getEditorComponent?(): EditorFactory | undefined;
  readonly theme?: Theme;
  getAllThemes?(): {name: string; path: string | undefined}[];
  getTheme?(name: string): Theme | undefined;
  setTheme?(theme: string | Theme): {success: boolean; error?: string};
  getToolsExpanded?(): boolean;
  setToolsExpanded?(expanded: boolean): void;
}

export interface ContextUsage {tokens: number | null; contextWindow: number; percent: number | null; cost?: number}
export interface CompactOptions {customInstructions?: string; onComplete?: (result: CompactionResult) => void; onError?: (error: Error) => void}
export type CompactionPreparation = Record<string, unknown> & {firstKeptEntryId?: string; tokensBefore?: number};
export type CompactionResult = Record<string, unknown> & {summary?: string; firstKeptEntryId?: string; tokensBefore?: number};

export type ModelCost = {input: number; output: number; cacheRead: number; cacheWrite: number};
export type Model<TApi = unknown> = Record<string, unknown> & {provider: string; id: string; name?: string; api?: TApi; input?: ("text" | "image")[]; reasoning?: boolean; cost?: ModelCost; contextWindow?: number; maxTokens?: number};
export type ModelRegistry = {
  find?(provider: string, id: string): Model | undefined;
  getAvailable(): Promise<Model[]>;
};
export type BuildSystemPromptOptions = {
  customPrompt?: string;
  selectedTools?: Array<string | {name?: string}>;
  toolSnippets?: string[];
  promptGuidelines?: string[];
  appendSystemPrompt?: string[];
  cwd?: string;
  contextFiles?: Array<{path: string; content?: string}>;
  skills?: Array<Record<string, unknown>>;
};

// Loosened from public ExtensionContext for lightweight tests/mocks in this
// package. Pi provides these members at runtime.
export interface ExtensionContext {
  ui?: ExtensionUIContext;
  mode?: ExtensionMode;
  hasUI?: boolean;
  cwd: string;
  sessionManager?: ReadonlySessionManager;
  modelRegistry?: ModelRegistry;
  model?: Model;
  isIdle?(): boolean;
  isProjectTrusted?(): boolean;
  signal?: AbortSignal;
  abort?(): void;
  hasPendingMessages?(): boolean;
  shutdown?(): void;
  getContextUsage?(): ContextUsage | undefined;
  compact?(options?: CompactOptions): void;
  getSystemPrompt?(): string;
}

export interface ExtensionCommandContext extends ExtensionContext {
  getSystemPromptOptions(): BuildSystemPromptOptions;
  waitForIdle(): Promise<void>;
  newSession(options?: {parentSession?: string; setup?: (sessionManager: SessionManager) => Promise<void>; withSession?: (ctx: ReplacedSessionContext) => Promise<void>}): Promise<{cancelled: boolean}>;
  fork(entryId: string, options?: {position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void>}): Promise<{cancelled: boolean}>;
  navigateTree(targetId: string, options?: {summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string}): Promise<{cancelled: boolean}>;
  switchSession(sessionPath: string, options?: {withSession?: (ctx: ReplacedSessionContext) => Promise<void>}): Promise<{cancelled: boolean}>;
  reload(): Promise<void>;
}
export interface ReplacedSessionContext extends ExtensionCommandContext {
  sendMessage<T = unknown>(message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">, options?: {triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn"}): Promise<void>;
  sendUserMessage(content: string | (TextContent | ImageContent)[], options?: {deliverAs?: "steer" | "followUp"}): Promise<void>;
}

export interface ToolRenderResultOptions {expanded: boolean; isPartial: boolean}
export interface ToolRenderContext<TState = unknown, TArgs = unknown> {args: TArgs; toolCallId: string; invalidate: () => void; lastComponent: Component | undefined; state: TState; cwd: string; executionStarted: boolean; argsComplete: boolean; isPartial: boolean; expanded: boolean; showImages: boolean; isError: boolean}

export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  renderShell?: "default" | "self";
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: ToolExecutionMode;
  execute(toolCallId: string, params: Static<TParams>, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<TDetails>, ctx?: ExtensionContext): Promise<AgentToolResult<TDetails>>;
  renderCall?: (args: Static<TParams>, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
  renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
}
type AnyToolDefinition = ToolDefinition<any, any, any>;
export function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(tool: ToolDefinition<TParams, TDetails, TState>): ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition { return tool as ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition; }

export interface ProjectTrustEvent {type: "project_trust"; cwd: string}
export type ProjectTrustEventDecision = "yes" | "no" | "undecided";
export interface ProjectTrustEventResult {trusted: ProjectTrustEventDecision; remember?: boolean}
export type ProjectTrustDecision = boolean | null;
export interface ProjectTrustContext {cwd: string; mode: ExtensionMode; hasUI: boolean; ui: Pick<ExtensionUIContext, "select" | "confirm" | "input" | "notify">}
export type ProjectTrustHandler = (event: ProjectTrustEvent, ctx: ProjectTrustContext) => Promise<ProjectTrustEventResult> | ProjectTrustEventResult;
export interface ResourcesDiscoverEvent {type: "resources_discover"; cwd: string; reason: "startup" | "reload"}
export interface ResourcesDiscoverResult {skillPaths?: string[]; promptPaths?: string[]; themePaths?: string[]}

export interface SessionStartEvent {type: "session_start"; reason: "startup" | "reload" | "new" | "resume" | "fork"; previousSessionFile?: string}
export interface SessionBeforeSwitchEvent {type: "session_before_switch"; reason: "new" | "resume"; targetSessionFile?: string}
export interface SessionBeforeForkEvent {type: "session_before_fork"; entryId: string; position: "before" | "at"}
export interface SessionBeforeCompactEvent {type: "session_before_compact"; preparation: CompactionPreparation; branchEntries: SessionEntry[]; customInstructions?: string; reason: "manual" | "threshold" | "overflow"; willRetry: boolean; signal: AbortSignal}
export interface SessionCompactEvent {type: "session_compact"; compactionEntry: CompactionEntry; fromExtension: boolean; reason: "manual" | "threshold" | "overflow"; willRetry: boolean}
export interface SessionShutdownEvent {type: "session_shutdown"; reason: "quit" | "reload" | "new" | "resume" | "fork"; targetSessionFile?: string}
export interface TreePreparation {targetId: string; oldLeafId: string | null; commonAncestorId: string | null; entriesToSummarize: SessionEntry[]; userWantsSummary: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string}
export interface SessionBeforeTreeEvent {type: "session_before_tree"; preparation: TreePreparation; signal: AbortSignal}
export interface SessionTreeEvent {type: "session_tree"; newLeafId: string | null; oldLeafId: string | null; summaryEntry?: BranchSummaryEntry; fromExtension?: boolean}
export type SessionEvent = SessionStartEvent | SessionBeforeSwitchEvent | SessionBeforeForkEvent | SessionBeforeCompactEvent | SessionCompactEvent | SessionShutdownEvent | SessionBeforeTreeEvent | SessionTreeEvent;

export interface ContextEvent {type: "context"; messages: AgentMessage[]}
export interface BeforeProviderRequestEvent {type: "before_provider_request"; payload: unknown}
export interface AfterProviderResponseEvent {type: "after_provider_response"; status: number; headers: Record<string, string>}
export interface BeforeAgentStartEvent {type: "before_agent_start"; prompt: string; images?: ImageContent[]; systemPrompt: string; systemPromptOptions: BuildSystemPromptOptions}
export interface AgentStartEvent {type: "agent_start"}
export interface AgentEndEvent {type: "agent_end"; messages: AgentMessage[]}
export interface TurnStartEvent {type: "turn_start"; turnIndex: number; timestamp: number}
export interface TurnEndEvent {type: "turn_end"; turnIndex: number; message: AgentMessage; toolResults: ToolResultMessage[]}
export interface MessageStartEvent {type: "message_start"; message: AgentMessage}
export interface MessageUpdateEvent {type: "message_update"; message: AgentMessage; assistantMessageEvent: unknown}
export interface MessageEndEvent {type: "message_end"; message: AgentMessage}
export type MessageEvent = MessageStartEvent | MessageEndEvent;
export interface ToolExecutionStartEvent {type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown}
export interface ToolExecutionUpdateEvent {type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown}
export interface ToolExecutionEndEvent {type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean}
export type ModelSelectSource = "set" | "cycle" | "restore";
export interface ModelSelectEvent {type: "model_select"; model: Model; previousModel: Model | undefined; source: ModelSelectSource}
export interface ThinkingLevelSelectEvent {type: "thinking_level_select"; level: ThinkingLevel; previousLevel: ThinkingLevel}
export interface UserBashEvent {type: "user_bash"; command: string; excludeFromContext: boolean; cwd: string}
export type InputSource = "interactive" | "rpc" | "extension";
export interface InputEvent {type: "input"; text: string; images?: ImageContent[]; source: InputSource; streamingBehavior?: "steer" | "followUp"}
export type InputEventResult = {action: "continue"} | {action: "transform"; text: string; images?: ImageContent[]} | {action: "handled"};

export type BashToolInput = {command: string; timeout?: number};
export type ReadToolInput = {path: string; offset?: number; limit?: number};
export type EditToolInput = {path: string; edits: Array<{oldText: string; newText: string}>};
export type WriteToolInput = {path: string; content: string};
export type GrepToolInput = {pattern: string; path?: string; glob?: string; ignoreCase?: boolean; literal?: boolean; context?: number; limit?: number};
export type FindToolInput = {pattern: string; path?: string; limit?: number};
export type LsToolInput = {path?: string; limit?: number};
export type TruncationResult = {content: string; truncated: boolean; totalLines?: number; outputLines?: number; totalBytes?: number; outputBytes?: number};
export interface BashToolDetails {truncation?: TruncationResult; fullOutputPath?: string}
export interface ReadToolDetails {truncation?: TruncationResult}
export interface EditToolDetails {diff: string; patch: string; firstChangedLine?: number}
export interface GrepToolDetails {truncation?: TruncationResult; matchLimitReached?: number; linesTruncated?: boolean}
export interface FindToolDetails {truncation?: TruncationResult; resultLimitReached?: number}
export interface LsToolDetails {truncation?: TruncationResult; entryLimitReached?: number}

interface ToolCallEventBase {type: "tool_call"; toolCallId: string}
export interface BashToolCallEvent extends ToolCallEventBase {toolName: "bash"; input: BashToolInput}
export interface ReadToolCallEvent extends ToolCallEventBase {toolName: "read"; input: ReadToolInput}
export interface EditToolCallEvent extends ToolCallEventBase {toolName: "edit"; input: EditToolInput}
export interface WriteToolCallEvent extends ToolCallEventBase {toolName: "write"; input: WriteToolInput}
export interface GrepToolCallEvent extends ToolCallEventBase {toolName: "grep"; input: GrepToolInput}
export interface FindToolCallEvent extends ToolCallEventBase {toolName: "find"; input: FindToolInput}
export interface LsToolCallEvent extends ToolCallEventBase {toolName: "ls"; input: LsToolInput}
export interface CustomToolCallEvent extends ToolCallEventBase {toolName: string; input: Record<string, unknown>}
export type ToolCallEvent = BashToolCallEvent | ReadToolCallEvent | EditToolCallEvent | WriteToolCallEvent | GrepToolCallEvent | FindToolCallEvent | LsToolCallEvent | CustomToolCallEvent;

interface ToolResultEventBase {type: "tool_result"; toolCallId: string; input: Record<string, unknown>; content: (TextContent | ImageContent)[]; isError: boolean}
export interface BashToolResultEvent extends ToolResultEventBase {toolName: "bash"; details: BashToolDetails | undefined}
export interface ReadToolResultEvent extends ToolResultEventBase {toolName: "read"; details: ReadToolDetails | undefined}
export interface EditToolResultEvent extends ToolResultEventBase {toolName: "edit"; details: EditToolDetails | undefined}
export interface WriteToolResultEvent extends ToolResultEventBase {toolName: "write"; details: undefined}
export interface GrepToolResultEvent extends ToolResultEventBase {toolName: "grep"; details: GrepToolDetails | undefined}
export interface FindToolResultEvent extends ToolResultEventBase {toolName: "find"; details: FindToolDetails | undefined}
export interface LsToolResultEvent extends ToolResultEventBase {toolName: "ls"; details: LsToolDetails | undefined}
export interface CustomToolResultEvent extends ToolResultEventBase {toolName: string; details: unknown}
export type ToolResultEvent = BashToolResultEvent | ReadToolResultEvent | EditToolResultEvent | WriteToolResultEvent | GrepToolResultEvent | FindToolResultEvent | LsToolResultEvent | CustomToolResultEvent;

export function isBashToolResult(e: ToolResultEvent): e is BashToolResultEvent { return e.toolName === "bash"; }
export function isReadToolResult(e: ToolResultEvent): e is ReadToolResultEvent { return e.toolName === "read"; }
export function isEditToolResult(e: ToolResultEvent): e is EditToolResultEvent { return e.toolName === "edit"; }
export function isWriteToolResult(e: ToolResultEvent): e is WriteToolResultEvent { return e.toolName === "write"; }
export function isGrepToolResult(e: ToolResultEvent): e is GrepToolResultEvent { return e.toolName === "grep"; }
export function isFindToolResult(e: ToolResultEvent): e is FindToolResultEvent { return e.toolName === "find"; }
export function isLsToolResult(e: ToolResultEvent): e is LsToolResultEvent { return e.toolName === "ls"; }

export function isToolCallEventType(toolName: "bash", event: ToolCallEvent): event is BashToolCallEvent;
export function isToolCallEventType(toolName: "read", event: ToolCallEvent): event is ReadToolCallEvent;
export function isToolCallEventType(toolName: "edit", event: ToolCallEvent): event is EditToolCallEvent;
export function isToolCallEventType(toolName: "write", event: ToolCallEvent): event is WriteToolCallEvent;
export function isToolCallEventType(toolName: "grep", event: ToolCallEvent): event is GrepToolCallEvent;
export function isToolCallEventType(toolName: "find", event: ToolCallEvent): event is FindToolCallEvent;
export function isToolCallEventType(toolName: "ls", event: ToolCallEvent): event is LsToolCallEvent;
export function isToolCallEventType<TName extends string, TInput extends Record<string, unknown>>(toolName: TName, event: ToolCallEvent): event is ToolCallEvent & {toolName: TName; input: TInput};
export function isToolCallEventType(toolName: string, event: ToolCallEvent): boolean { return event.toolName === toolName; }

export type ExtensionEvent = ProjectTrustEvent | ResourcesDiscoverEvent | SessionEvent | ContextEvent | BeforeProviderRequestEvent | AfterProviderResponseEvent | BeforeAgentStartEvent | AgentStartEvent | AgentEndEvent | TurnStartEvent | TurnEndEvent | MessageStartEvent | MessageUpdateEvent | MessageEndEvent | ToolExecutionStartEvent | ToolExecutionUpdateEvent | ToolExecutionEndEvent | ModelSelectEvent | ThinkingLevelSelectEvent | UserBashEvent | InputEvent | ToolCallEvent | ToolResultEvent;

export interface ContextEventResult {messages?: AgentMessage[]}
export type BeforeProviderRequestEventResult = unknown;
export interface ToolCallEventResult {block?: boolean; reason?: string}
export type ToolCallDecision = ToolCallEventResult;
export type BashResult = {output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean; fullOutputPath?: string};
export interface BashOperations {exec(command: string, cwd: string, options: {onData: (data: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv}): Promise<{exitCode: number | null}>}
export interface UserBashEventResult {operations?: BashOperations; result?: BashResult}
export type UserBashDecision = UserBashEventResult;
export interface ToolResultEventResult {content?: (TextContent | ImageContent)[]; details?: unknown; isError?: boolean}
export interface MessageEndEventResult {message?: AgentMessage}
export interface BeforeAgentStartEventResult {message?: Pick<CustomMessage, "customType" | "content" | "display" | "details">; systemPrompt?: string}
export interface SessionBeforeSwitchResult {cancel?: boolean}
export interface SessionBeforeForkResult {cancel?: boolean; skipConversationRestore?: boolean}
export interface SessionBeforeCompactResult {cancel?: boolean; compaction?: CompactionResult}
export interface SessionBeforeTreeResult {cancel?: boolean; summary?: {summary: string; details?: unknown}; customInstructions?: string; replaceInstructions?: boolean; label?: string}
export type CancelDecision = {cancel: true};

export interface MessageRenderOptions {expanded: boolean}
export type CustomMessage<T = unknown> = {customType: string; content: string | (TextContent | ImageContent)[]; display: boolean; details?: T};
export type MessageRenderer<T = unknown> = (message: CustomMessage<T>, options: MessageRenderOptions, theme: Theme) => Component | undefined;
export interface RegisteredCommand {name: string; sourceInfo: SourceInfo; description?: string; getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void}
export type CommandDefinition = Omit<RegisteredCommand, "name" | "sourceInfo">;
export type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;

export type Api = string;
export type Context = unknown;
export type SimpleStreamOptions = Record<string, unknown>;
export type AssistantMessageEventStream = AsyncIterable<unknown>;
export type OAuthCredentials = Record<string, unknown>;
export type OAuthLoginCallbacks = Record<string, unknown>;
export interface ProviderConfig {name?: string; baseUrl?: string; apiKey?: string; api?: Api; streamSimple?: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream; headers?: Record<string, string>; authHeader?: boolean; models?: ProviderModelConfig[]; oauth?: {name: string; login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>; refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>; getApiKey(credentials: OAuthCredentials): string; modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[]}}
export interface ProviderModelConfig {id: string; name: string; api?: Api; baseUrl?: string; reasoning: boolean; thinkingLevelMap?: unknown; input: ("text" | "image")[]; cost: ModelCost; contextWindow: number; maxTokens: number; headers?: Record<string, string>; compat?: unknown}
export type ToolInfo = Pick<ToolDefinition, "name" | "description" | "parameters" | "promptGuidelines"> & {sourceInfo: SourceInfo};
export type SlashCommandInfo = {name: string; description?: string; source: "extension" | "prompt" | "skill" | string; sourceInfo: SourceInfo};
export type ExecOptions = {cwd?: string; signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv};
export type ExecResult = {stdout: string; stderr: string; code: number | null; killed?: boolean};

// API members are optional here so unit tests can use minimal mocks. Public
// ExtensionAPI exposes these members as required.
export interface PiExtensionApi {
  on(event: "project_trust", handler: ProjectTrustHandler): void;
  on(event: "resources_discover", handler: ExtensionHandler<ResourcesDiscoverEvent, ResourcesDiscoverResult>): void;
  on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
  on(event: "session_before_switch", handler: ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>): void;
  on(event: "session_before_fork", handler: ExtensionHandler<SessionBeforeForkEvent, SessionBeforeForkResult>): void;
  on(event: "session_before_compact", handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>): void;
  on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
  on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
  on(event: "session_before_tree", handler: ExtensionHandler<SessionBeforeTreeEvent, SessionBeforeTreeResult>): void;
  on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
  on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
  on(event: "before_provider_request", handler: ExtensionHandler<BeforeProviderRequestEvent, BeforeProviderRequestEventResult>): void;
  on(event: "after_provider_response", handler: ExtensionHandler<AfterProviderResponseEvent>): void;
  on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;
  on(event: "agent_start", handler: ExtensionHandler<AgentStartEvent>): void;
  on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): void;
  on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
  on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent>): void;
  on(event: "message_start", handler: ExtensionHandler<MessageStartEvent>): void;
  on(event: "message_update", handler: ExtensionHandler<MessageUpdateEvent>): void;
  on(event: "message_end", handler: ExtensionHandler<MessageEndEvent, MessageEndEventResult>): void;
  on(event: "tool_execution_start", handler: ExtensionHandler<ToolExecutionStartEvent>): void;
  on(event: "tool_execution_update", handler: ExtensionHandler<ToolExecutionUpdateEvent>): void;
  on(event: "tool_execution_end", handler: ExtensionHandler<ToolExecutionEndEvent>): void;
  on(event: "model_select", handler: ExtensionHandler<ModelSelectEvent>): void;
  on(event: "thinking_level_select", handler: ExtensionHandler<ThinkingLevelSelectEvent>): void;
  on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
  on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;
  on(event: "user_bash", handler: ExtensionHandler<UserBashEvent, UserBashEventResult>): void;
  on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): void;
  on(event: string, handler: ExtensionHandler<Record<string, unknown>, unknown>): void;
  registerTool?(tool: ToolDefinition): void;
  registerCommand?(name: string, options: CommandDefinition): void;
  registerShortcut?(shortcut: KeyId, options: {description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void}): void;
  registerFlag?(name: string, options: {description?: string; type: "boolean" | "string"; default?: boolean | string}): void;
  getFlag?(name: string): boolean | string | undefined;
  registerMessageRenderer?<T = unknown>(customType: string, renderer: MessageRenderer<T>): void;
  sendMessage?<T = unknown>(message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">, options?: {triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn"}): void;
  sendUserMessage?(content: string | (TextContent | ImageContent)[], options?: {deliverAs?: "steer" | "followUp"}): void;
  appendEntry?<T = unknown>(customType: string, data?: T): void;
  setSessionName?(name: string): void;
  getSessionName?(): string | undefined;
  setLabel?(entryId: string, label: string | undefined): void;
  exec?(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  getActiveTools?(): string[];
  getAllTools?(): ToolInfo[];
  setActiveTools?(toolNames: string[]): void;
  getCommands?(): SlashCommandInfo[];
  setModel?(model: Model): Promise<boolean>;
  getThinkingLevel?(): ThinkingLevel;
  setThinkingLevel?(level: ThinkingLevel): void;
  registerProvider?(name: string, config: ProviderConfig): void;
  unregisterProvider?(name: string): void;
  events?: EventBus;
}

export type ExtensionAPI = PiExtensionApi;
export type ExtensionFactory = (pi: PiExtensionApi) => void | Promise<void>;
