type ThemeLike = {
  fg?(color: string, text: string): string;
  bold?(text: string): string;
};

type TextComponent = {
  render(width: number): string[];
  invalidate(): void;
};

const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ansiTokenPattern = /(\x1b\[[0-?]*[ -/]*[@-~])/g;

export function renderToolCallInput(toolName: string, args: Record<string, unknown>, theme?: ThemeLike): TextComponent {
  const title = color(theme, "toolTitle", bold(theme, toolName));
  const preview = formatArgs(args, theme);
  const text = preview ? `${title}\n${preview}` : title;
  return textComponent(text);
}

function textComponent(text: string): TextComponent {
  return {
    render(width: number): string[] {
      return text.split("\n").map((line) => truncateToWidth(line, width));
    },
    invalidate(): void {
      // Static component.
    },
  };
}

function formatArgs(args: Record<string, unknown>, theme: ThemeLike | undefined): string {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => color(theme, "dim", `  ${key}: ${formatValue(value)}`))
    .join("\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return quote(shorten(value));
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (value && typeof value === "object") return shorten(JSON.stringify(value));
  return String(value);
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

function truncateToWidth(value: string, width: number): string {
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
