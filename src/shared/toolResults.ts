export type TextToolResult = {
  content: Array<{type: "text"; text: string}>;
  details?: Record<string, unknown>;
  isError?: boolean;
};

export function successResult(text: string, details: Record<string, unknown> = {}, isError = false): TextToolResult {
  return {
    content: [{type: "text", text}],
    details: isError ? {...details, error: true} : details,
    ...(isError ? {isError: true} : {}),
  };
}

export function errorResult(text: string, details: Record<string, unknown> = {}): TextToolResult {
  return {
    content: [{type: "text", text}],
    details: {...details, error: true},
    isError: true,
  };
}
