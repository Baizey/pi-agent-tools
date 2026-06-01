export type PiExtensionApi = {
  on(
    event: "tool_call",
    handler: (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallDecision | void> | ToolCallDecision | void,
  ): void;
  on(
    event: "user_bash",
    handler: (event: UserBashEvent, ctx: ExtensionContext) => Promise<UserBashDecision | void> | UserBashDecision | void,
  ): void;
  on(
    event: "before_agent_start",
    handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<BeforeAgentStartDecision | void> | BeforeAgentStartDecision | void,
  ): void;
  registerTool?(definition: ToolDefinition): void;
};

export type ToolCallEvent = {
  toolName: string;
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
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: Record<string, unknown>;
    isError?: boolean;
  }>;
  renderCall?(args: Record<string, unknown>, theme?: unknown, context?: unknown): unknown;
};

export type UserBashEvent = {
  command: string;
  cwd: string;
  excludeFromContext: boolean;
};

export type UserBashDecision = {
  result: {
    output: string;
    exitCode: number;
    cancelled: boolean;
    truncated: boolean;
  };
};

export type BeforeAgentStartEvent = {
  prompt: string;
  systemPrompt: string;
  systemPromptOptions?: {
    selectedTools?: Array<string | {name?: string}>;
  };
};

export type BeforeAgentStartDecision = {
  systemPrompt?: string;
  message?: Record<string, unknown>;
};

export type ExtensionContext = {
  cwd: string;
  hasUI?: boolean;
  ui?: {
    select(title: string, items: string[]): Promise<string | undefined>;
  };
};
