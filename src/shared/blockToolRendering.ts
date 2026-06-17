export function renderBlockToolCall(header: string, fields: Array<string | null | undefined>, blockLabel: string, block: string) {
  const lines = [
    header,
    ...fields.filter((field): field is string => Boolean(field)),
    `  ${blockLabel}:`,
    ...block.split(/\r?\n/).map(line => `    ${line}`),
  ];
  return {
    render(width: number): string[] {
      return lines.map(line => width > 0 && line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line);
    },
    invalidate(): void {},
  };
}
