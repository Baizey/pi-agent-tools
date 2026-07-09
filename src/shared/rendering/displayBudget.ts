export enum FoldDirection {
  HEAD = "head",
  TAIL = "tail",
}

export type DisplayWindow<T> = {
  items: T[];
  omitted: number;
};

export type TextWindow = {
  text: string;
  truncated: boolean;
};

/**
 * Selects a bounded head or tail window without deciding how omissions are rendered.
 */
export function selectDisplayWindow<T>(
  items: readonly T[],
  maxItems: number,
  direction: FoldDirection = FoldDirection.HEAD,
): DisplayWindow<T> {
  const limit = normalizeLimit(maxItems);
  if (items.length <= limit) return {items: [...items], omitted: 0};

  const selected = direction === FoldDirection.TAIL
    ? items.slice(items.length - limit)
    : items.slice(0, limit);
  return {
    items: selected,
    omitted: items.length - selected.length,
  };
}

/**
 * Bounds a string before line splitting or other display-oriented processing.
 */
export function selectTextWindow(
  text: string,
  maxCharacters: number,
  direction: FoldDirection = FoldDirection.HEAD,
): TextWindow {
  const limit = normalizeLimit(maxCharacters);
  if (text.length <= limit) return {text, truncated: false};

  return {
    text: limit === 0 ? "" : direction === FoldDirection.TAIL ? text.slice(-limit) : text.slice(0, limit),
    truncated: true,
  };
}

export function addBoundaryNotice<T>(items: readonly T[], notice: T, direction: FoldDirection): T[] {
  return direction === FoldDirection.TAIL
    ? [notice, ...items]
    : [...items, notice];
}

export function omittedLinesNotice(count: number): string {
  return `... (${count} ${count === 1 ? "line" : "lines"} omitted from display)`;
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
