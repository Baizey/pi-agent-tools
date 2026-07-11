import {addBoundaryNotice, FoldDirection, omittedLinesNotice, selectDisplayWindow, selectTextWindow} from "./rendering/displayBudget";
import {renderLineFactory} from "./rendering/terminalText";
import type {TextComponent} from "./rendering/terminalText";
import type {ExpansionContext, RenderTheme} from "./rendering/types";
import {formatDisplayValue} from "./rendering/valueFormat";
import {foldLines} from "./toolRendering";

export type ToolField = {
  label: string;
  value: unknown;
  omit?: boolean;
};

export type BlockToolCall = {
  title: string;
  fields?: readonly ToolField[];
  block: {
    label: string;
    text: string;
  };
  fold?: {
    direction?: FoldDirection;
    previewLines?: number;
  };
};

const maxBlockToolLines = 2_000;
const maxBlockFieldLines = 100;
const maxBlockDisplayCharacters = 200_000;
const blockTruncatedNotice = "[block display truncated]";

export function renderBlockToolCall(
  call: BlockToolCall,
  theme?: RenderTheme,
  context?: ExpansionContext,
): TextComponent {
  return renderLineFactory(() => {
    const title = color(theme, "toolTitle", bold(theme, call.title));
    const fields = formatFields(call.fields ?? [], theme);
    const blockLineBudget = maxBlockToolLines - 1 - fields.length;
    const blockLines = formatBlock(call.block, context, call.fold ?? {}, blockLineBudget, fields.length === 0);
    return [title, ...fields, ...blockLines];
  });
}

function formatFields(fields: readonly ToolField[], theme: RenderTheme | undefined): string[] {
  const lines: string[] = [];
  let omitted = false;

  for (const field of fields) {
    if (field.omit || field.value === undefined) continue;
    if (lines.length >= maxBlockFieldLines - 1) {
      omitted = true;
      break;
    }
    lines.push(color(theme, "dim", `  ${field.label}: ${formatDisplayValue(field.value)}`));
  }

  if (omitted) lines.push(color(theme, "dim", "  ... additional fields omitted"));
  return lines;
}

function formatBlock(
  block: BlockToolCall["block"],
  context: ExpansionContext | undefined,
  fold: NonNullable<BlockToolCall["fold"]>,
  maxLines: number,
  omitLabel: boolean,
): string[] {
  const direction = fold.direction ?? FoldDirection.HEAD;
  const bounded = selectTextWindow(block.text, maxBlockDisplayCharacters, direction);
  const allLines = bounded.text.split(/\r\n|\n|\r/);
  const contentLineBudget = Math.max(1, maxLines - (omitLabel ? 0 : 1));
  const selectedLines = context?.expanded === false
    ? foldLines(allLines, context, {
      ...fold,
      previewLines: collapsedPreviewLines(fold.previewLines, contentLineBudget, bounded.truncated),
    })
    : boundExpandedLines(allLines, direction, bounded.truncated ? 1 : 0, contentLineBudget);
  const visibleLines = bounded.truncated
    ? addBoundaryNotice(selectedLines, blockTruncatedNotice, direction)
    : selectedLines;

  if (omitLabel) return visibleLines.map(line => `  ${line}`);
  if (visibleLines.length === 1) return [`  ${block.label}: ${visibleLines[0] ?? ""}`];
  return [`  ${block.label}:`, ...visibleLines.map(line => `    ${line}`)];
}

function collapsedPreviewLines(requested: number | undefined, lineBudget: number, truncated: boolean): number {
  const fallback = 8;
  const normalized = requested === undefined || !Number.isFinite(requested)
    ? fallback
    : Math.max(1, Math.floor(requested));
  const noticeLines = truncated ? 2 : 1; // Character notice plus a possible fold notice.
  return Math.max(1, Math.min(normalized, lineBudget - noticeLines));
}

function boundExpandedLines(
  lines: string[],
  direction: FoldDirection,
  reservedLines: number,
  maxLines: number,
): string[] {
  const available = Math.max(1, maxLines - reservedLines);
  if (lines.length <= available) return lines;

  const window = selectDisplayWindow(lines, available - 1, direction);
  return addBoundaryNotice(window.items, omittedLinesNotice(window.omitted), direction);
}

function color(theme: RenderTheme | undefined, name: string, text: string): string {
  return theme?.fg ? theme.fg(name, text) : text;
}

function bold(theme: RenderTheme | undefined, text: string): string {
  return theme?.bold ? theme.bold(text) : text;
}
