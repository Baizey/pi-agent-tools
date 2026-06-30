import {FoldDirection, foldLines, truncateToWidth} from "./toolRendering";

type RenderContextLike = {
  expanded?: boolean;
};

type BlockFoldOptions = {
  direction?: FoldDirection;
  previewLines?: number;
};

export function renderBlockToolCall(
  header: string,
  fields: Array<string | null | undefined>,
  blockLabel: string,
  block: string,
  context?: RenderContextLike,
  options: BlockFoldOptions = {},
) {
  const expanded = context?.expanded !== false;
  const blockLines = block.split(/\r?\n/);
  const lines = [
    header,
    ...fields.filter((field): field is string => Boolean(field)),
    ...renderBlockLines(blockLabel, blockLines, expanded ? {expanded: true} : context, options),
  ];
  return {
    render(width: number): string[] {
      return lines.map(line => truncateToWidth(line, width));
    },
    invalidate(): void {},
  };
}

function renderBlockLines(
  blockLabel: string,
  blockLines: string[],
  context: RenderContextLike | undefined,
  options: BlockFoldOptions,
): string[] {
  if (blockLines.length <= 1) return [`  ${blockLabel}: ${blockLines[0] ?? ""}`];
  const preview = foldLines(blockLines.map(line => `    ${line}`), context, options, undefined, "    ");
  return [`  ${blockLabel}:`, ...preview];
}
