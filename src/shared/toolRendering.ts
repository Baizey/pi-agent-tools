type ThemeLike = {
  fg?(color: string, text: string): string;
  bold?(text: string): string;
};

type TextComponent = {
  render(width: number): string[];
  invalidate(): void;
};

export function renderToolCallInput(toolName: string, args: Record<string, unknown>, theme?: ThemeLike): TextComponent {
  const title = color(theme, "toolTitle", bold(theme, toolName));
  const preview = formatArgs(args, theme);
  const text = preview ? `${title}\n${preview}` : title;
  return textComponent(text);
}

function textComponent(text: string): TextComponent {
  return {
    render(): string[] {
      return text.split("\n");
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

function color(theme: ThemeLike | undefined, name: string, text: string): string {
  return theme?.fg ? theme.fg(name, text) : text;
}

function bold(theme: ThemeLike | undefined, text: string): string {
  return theme?.bold ? theme.bold(text) : text;
}
