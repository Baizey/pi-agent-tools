import {FoldDirection, foldLines, renderLines} from "./toolRendering";

type RenderContextLike = {
  expanded?: boolean;
};

type BlockFoldOptions = {
  direction?: FoldDirection;
  previewLines?: number;
};

const maxExpandedBlockLines = 2_000;
const maxBlockDisplayCharacters = 200_000;

export function renderBlockToolCall(
  header: string,
  fields: Array<string | null | undefined>,
  blockLabel: string,
  block: string,
  context?: RenderContextLike,
  options: BlockFoldOptions = {},
) {
  const expanded = context?.expanded !== false;
  const displayBlock = limitBlockCharacters(block, options.direction);
  const blockLines = limitExpandedBlockLines(displayBlock.split(/\r\n|\n|\r/), expanded, options.direction);
  const lines = [
    header,
    ...fields.filter((field): field is string => Boolean(field)),
    ...renderBlockLines(blockLabel, blockLines, expanded ? {expanded: true} : context, options),
  ];
  return renderLines(lines);
}

function limitBlockCharacters(block: string, direction: FoldDirection | undefined): string {
  if (block.length <= maxBlockDisplayCharacters) return block;
  const notice = "[block display truncated]";
  return direction === FoldDirection.TAIL
    ? `${notice}\n${block.slice(-maxBlockDisplayCharacters)}`
    : `${block.slice(0, maxBlockDisplayCharacters)}\n${notice}`;
}

function limitExpandedBlockLines(lines: string[], expanded: boolean, direction: FoldDirection | undefined): string[] {
  if (!expanded || lines.length <= maxExpandedBlockLines) return lines;

  const retained = maxExpandedBlockLines - 1;
  const omitted = lines.length - retained;
  const notice = `... (${omitted} ${omitted === 1 ? "line" : "lines"} omitted from display)`;
  return direction === FoldDirection.TAIL
    ? [notice, ...lines.slice(-retained)]
    : [...lines.slice(0, retained), notice];
}

function renderBlockLines(
  blockLabel: string,
  blockLines: string[],
  context: RenderContextLike | undefined,
  options: BlockFoldOptions,
): string[] {
  if (blockLines.length <= 1) return [`  ${blockLabel}: ${blockLines[0] ?? ""}`];
  const preview = foldLines(blockLines, context, options).map(line => `    ${line}`);
  return [`  ${blockLabel}:`, ...preview];
}
