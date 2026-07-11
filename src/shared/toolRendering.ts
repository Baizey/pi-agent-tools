import {addBoundaryNotice, FoldDirection, omittedLinesNotice, selectDisplayWindow} from "./rendering/displayBudget";
import {renderLineFactory, renderLines, truncateToWidth} from "./rendering/terminalText";
import type {TextComponent} from "./rendering/terminalText";
import type {ExpansionContext, RenderTheme} from "./rendering/types";
import {formatDisplayValue} from "./rendering/valueFormat";
import {formatKeybindingHint} from "./rendering/keybindingHint";
import {BoundedTextBuffer, TextRetention} from "./boundedText";

export {FoldDirection, renderLines, truncateToWidth};
export type {TextComponent};

type FoldOptions = {
  direction?: FoldDirection;
  previewLines?: number;
};

type ToolResultLike = {
  content?: Array<
    | {type: "text"; text?: string}
    | {type: "image"; mimeType?: string; source?: {mediaType?: string}}
  >;
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

const defaultFoldPreviewLines = 8;
const maxExpandedOutputLines = 2_000;
const maxToolCallArgumentLines = 200;
const maxDisplayCharacters = 200_000;
const displayTruncatedNotice = "[display truncated]";

export function renderToolCallInput(
  toolName: string,
  args: Record<string, unknown>,
  theme?: RenderTheme,
  context?: ExpansionContext,
  options: FoldOptions = {},
): TextComponent {
  return renderLineFactory(() => {
    const title = color(theme, "toolTitle", bold(theme, toolName));
    const argumentsPreview = foldLines(formatArgLines(args, theme), context, options, theme, "  ");
    return [title, ...argumentsPreview];
  });
}

export function renderToolResultOutput(
  result: ToolResultLike,
  theme?: RenderTheme,
  context?: ExpansionContext,
  options: FoldOptions = {},
): TextComponent {
  const direction = options.direction ?? FoldDirection.HEAD;
  const collected = collectResultText(result, direction);
  const text = collected.text.trimEnd();
  if (!text && !collected.truncated) return renderLines([]);

  const lines = text ? splitLines(text) : [];
  return renderLineFactory(() => {
    const selectedLines = context?.expanded === false
      ? foldLines(lines, context, options, theme)
      : limitExpandedLines(lines, direction, collected.truncated ? 1 : 0);
    const visibleLines = collected.truncated
      ? addBoundaryNotice(selectedLines, displayTruncatedNotice, direction)
      : selectedLines;
    return visibleLines.map(line => color(theme, "toolOutput", line));
  });
}

export function foldLines(
  lines: string[],
  context?: ExpansionContext,
  options: FoldOptions = {},
  theme?: RenderTheme,
  hintIndent = "",
): string[] {
  if (context?.expanded !== false) return lines;

  const previewSize = positiveInteger(options.previewLines, defaultFoldPreviewLines);
  const direction = options.direction ?? FoldDirection.HEAD;
  const window = selectDisplayWindow(lines, previewSize, direction);
  if (window.omitted === 0) return window.items;

  const hint = foldHintLine(theme, hintIndent, window.omitted, direction);
  return addBoundaryNotice(window.items, hint, direction);
}

function limitExpandedLines(lines: string[], direction: FoldDirection, reservedLines: number): string[] {
  const available = Math.max(1, maxExpandedOutputLines - reservedLines);
  if (lines.length <= available) return lines;

  const window = selectDisplayWindow(lines, available - 1, direction);
  return addBoundaryNotice(window.items, omittedLinesNotice(window.omitted), direction);
}

function foldHintLine(
  theme: RenderTheme | undefined,
  indent: string,
  omitted: number,
  direction: FoldDirection,
): string {
  const location = direction === FoldDirection.TAIL ? "earlier" : "more";
  const count = `${omitted} ${location} ${omitted === 1 ? "line" : "lines"}`;
  return color(theme, "muted", `${indent}... (${count}, `)
    + toolExpandHint(theme)
    + color(theme, "muted", ")");
}

function collectResultText(
  result: ToolResultLike,
  direction: FoldDirection,
): {text: string; truncated: boolean} {
  const retention = direction === FoldDirection.TAIL ? TextRetention.TAIL : TextRetention.HEAD;
  const output = new BoundedTextBuffer(maxDisplayCharacters, displayTruncatedNotice, retention);
  let hasContent = false;

  for (const part of result.content ?? []) {
    const value = part.type === "text"
      ? part.text ?? ""
      : `[image: ${part.mimeType ?? part.source?.mediaType ?? "unknown"}]`;
    if (!value) continue;

    if (hasContent) output.append("\n");
    output.append(value);
    hasContent = true;
  }

  return {text: output.content(), truncated: output.wasTruncated()};
}

function formatArgLines(args: Record<string, unknown>, theme: RenderTheme | undefined): string[] {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined);
  if (entries.length === 1) {
    return [color(theme, "dim", `  ${formatValue(entries[0][1])}`)];
  }

  const lines: string[] = [];
  let omitted = false;

  for (const [key, value] of entries) {
    if (lines.length >= maxToolCallArgumentLines - 1) {
      omitted = true;
      break;
    }
    lines.push(color(theme, "dim", `  ${key}: ${formatValue(value)}`));
  }

  if (omitted) lines.push(color(theme, "dim", "  ... additional arguments omitted"));
  return lines;
}

function formatValue(value: unknown): string {
  return formatDisplayValue(value, {quoteStrings: true});
}

function splitLines(value: string): string[] {
  return value.split(/\r\n|\n|\r/);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function toolExpandHint(theme: RenderTheme | undefined): string {
  return formatKeybindingHint({
    keybinding: ToolRenderKeybinding.TOOLS_EXPAND,
    defaultKey: ToolRenderDefaultKeyText.TOOLS_EXPAND,
    description: ToolRenderKeybindingDescription.EXPAND,
  }, theme);
}

function color(theme: RenderTheme | undefined, name: string, text: string): string {
  return theme?.fg ? theme.fg(name, text) : text;
}

function bold(theme: RenderTheme | undefined, text: string): string {
  return theme?.bold ? theme.bold(text) : text;
}
