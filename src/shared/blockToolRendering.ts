type RenderContextLike = {
  expanded?: boolean;
};

export function renderBlockToolCall(
  header: string,
  fields: Array<string | null | undefined>,
  blockLabel: string,
  block: string,
  context?: RenderContextLike,
) {
  const expanded = context?.expanded !== false;
  const blockLines = block.split(/\r?\n/);
  const lines = expanded
    ? [
      header,
      ...fields.filter((field): field is string => Boolean(field)),
      `  ${blockLabel}:`,
      ...blockLines.map(line => `    ${line}`),
    ]
    : [
      header,
      ...fields.filter((field): field is string => Boolean(field)),
      compactBlockLine(blockLabel, blockLines),
    ];
  return {
    render(width: number): string[] {
      return lines.map(line => truncate(line, width));
    },
    invalidate(): void {},
  };
}

function compactBlockLine(blockLabel: string, blockLines: string[]): string {
  const firstLine = blockLines[0] ?? "";
  const suffix = blockLines.length > 1 ? ` … (${blockLines.length - 1} more lines)` : "";
  return `  ${blockLabel}: ${firstLine}${suffix}`;
}

function truncate(line: string, width: number): string {
  if (!Number.isFinite(width) || width <= 0 || line.length <= width) return line;
  return `${line.slice(0, Math.max(0, width - 1))}…`;
}
