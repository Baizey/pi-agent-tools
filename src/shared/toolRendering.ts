type ThemeLike = {
  fg?(color: string, text: string): string;
  bold?(text: string): string;
};

type TextComponent = {
  render(width: number): string[];
  invalidate(): void;
};

type RenderContextLike = {
  expanded?: boolean;
};

export enum FoldDirection {
  HEAD = "head",
  TAIL = "tail",
}

type FoldOptions = {
  direction?: FoldDirection;
  previewLines?: number;
};

type ToolResultLike = {
  content?: Array<{type: "text"; text?: string} | {type: "image"; mimeType?: string}>;
};

export enum ToolRenderKeybinding {
  TOOLS_EXPAND = "app.tools.expand",
}

export enum ToolRenderDefaultKeyText {
  TOOLS_EXPAND = "ctrl+o",
}

export enum ToolRenderTerminalInput {
  TOOLS_EXPAND = "\x0f",
}

export enum ToolRenderKeybindingDescription {
  EXPAND = "to expand",
}

type KeyHintFn = (keybinding: string, description: string) => string;
type KeyTextFn = (keybinding: string) => string;

const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ansiTokenPattern = /(\x1b\[[0-?]*[ -/]*[@-~])/g;
const defaultFoldPreviewLines = 8;

export function renderToolCallInput(
  toolName: string,
  args: Record<string, unknown>,
  theme?: ThemeLike,
  context?: RenderContextLike,
  options: FoldOptions = {},
): TextComponent {
  const title = color(theme, "toolTitle", bold(theme, toolName));
  const argLines = formatArgLines(args, theme);
  const lines = [title, ...foldLines(argLines, context, options, theme, "  ")];
  return linesComponent(lines);
}

export function renderToolResultOutput(
  result: ToolResultLike,
  theme?: ThemeLike,
  context?: RenderContextLike,
  options: FoldOptions = {},
): TextComponent {
  const text = getTextOutput(result).trimEnd();
  if (!text) return linesComponent([]);

  const outputLines = text.split(/\r?\n/).map((line) => color(theme, "toolOutput", line));
  const lines = foldLines(outputLines, context, options, theme);
  return linesComponent(lines);
}

export function foldLines(
  lines: string[],
  context?: RenderContextLike,
  options: FoldOptions = {},
  theme?: ThemeLike,
  hintIndent = "",
): string[] {
  const expanded = context?.expanded !== false;
  const previewLines = Math.max(1, Math.floor(options.previewLines ?? defaultFoldPreviewLines));
  if (expanded || lines.length <= previewLines) return lines;

  const direction = options.direction ?? FoldDirection.HEAD;
  if (direction === FoldDirection.TAIL) {
    const skipped = lines.length - previewLines;
    return [
      foldHintLine(theme, hintIndent, formatLineCount(skipped, "earlier")),
      ...lines.slice(-previewLines),
    ];
  }

  const remaining = lines.length - previewLines;
  return [
    ...lines.slice(0, previewLines),
    foldHintLine(theme, hintIndent, formatLineCount(remaining, "more")),
  ];
}

function formatLineCount(count: number, label: "earlier" | "more"): string {
  return `${count} ${label} ${count === 1 ? "line" : "lines"}`;
}

function foldHintLine(theme: ThemeLike | undefined, indent: string, lineCount: string): string {
  return color(theme, "muted", `${indent}... (${lineCount}, `)
    + toolExpandHint(theme)
    + color(theme, "muted", ")");
}

function toolExpandHint(theme: ThemeLike | undefined): string {
  const helpers = piKeybindingHelpers();
  const keyText = helpers?.keyText?.(ToolRenderKeybinding.TOOLS_EXPAND);
  if (keyText?.trim()) {
    return helpers?.keyHint
      ? helpers.keyHint(ToolRenderKeybinding.TOOLS_EXPAND, ToolRenderKeybindingDescription.EXPAND)
      : formatToolExpandHint(theme, keyText);
  }
  return formatToolExpandHint(theme, ToolRenderDefaultKeyText.TOOLS_EXPAND);
}

function formatToolExpandHint(theme: ThemeLike | undefined, keyText: string): string {
  const text = `${keyText} ${ToolRenderKeybindingDescription.EXPAND}`;
  return color(theme, "dim", keyText) + color(theme, "muted", text.slice(keyText.length));
}

function piKeybindingHelpers(): {keyHint?: KeyHintFn; keyText?: KeyTextFn} | undefined {
  try {
    const piPackage = require("@earendil-works/pi-coding-agent") as {keyHint?: unknown; keyText?: unknown};
    return {
      keyHint: typeof piPackage.keyHint === "function" ? piPackage.keyHint as KeyHintFn : undefined,
      keyText: typeof piPackage.keyText === "function" ? piPackage.keyText as KeyTextFn : undefined,
    };
  } catch {
    return undefined;
  }
}

function linesComponent(lines: string[]): TextComponent {
  return {
    render(width: number): string[] {
      return lines.map((line) => truncateToWidth(line, width));
    },
    invalidate(): void {
      // Static component.
    },
  };
}

function formatArgLines(args: Record<string, unknown>, theme: ThemeLike | undefined): string[] {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return [];
  return entries.map(([key, value]) => color(theme, "dim", `  ${key}: ${formatValue(value)}`));
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return quote(shorten(value));
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (value && typeof value === "object") return shorten(JSON.stringify(value));
  return String(value);
}

function getTextOutput(result: ToolResultLike): string {
  const content = result.content ?? [];
  return content.map((item) => {
    if (item.type === "text") return item.text ?? "";
    return `[image: ${item.mimeType ?? "unknown"}]`;
  }).filter(Boolean).join("\n");
}

function shorten(value: string, maxLength = 120): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function visibleWidth(value: string): number {
  let width = 0;
  for (const char of value.replace(ansiPattern, "")) width += charWidth(char);
  return width;
}

export function truncateToWidth(value: string, width: number): string {
  if (!Number.isFinite(width)) return value;
  if (width <= 0) return "";
  if (visibleWidth(value) <= width) return value;
  if (width <= 1) return "…";

  const target = width - 1;
  let result = "";
  let used = 0;
  let hasAnsi = false;
  for (const token of value.split(ansiTokenPattern).filter(Boolean)) {
    if (ansiPattern.test(token)) {
      ansiPattern.lastIndex = 0;
      hasAnsi = true;
      result += token;
      continue;
    }
    ansiPattern.lastIndex = 0;
    for (const char of token) {
      const next = used + charWidth(char);
      if (next > target) return `${result}…${hasAnsi ? "\x1b[0m" : ""}`;
      result += char;
      used = next;
    }
  }
  return result;
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0 || code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (code >= 0x300 && code <= 0x36f) return 0;
  if (
    code >= 0x1100 && (
      code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    )
  ) return 2;
  return 1;
}

function color(theme: ThemeLike | undefined, name: string, text: string): string {
  return theme?.fg ? theme.fg(name, text) : text;
}

function bold(theme: ThemeLike | undefined, text: string): string {
  return theme?.bold ? theme.bold(text) : text;
}
