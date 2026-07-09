export type DisplayValueOptions = {
  quoteStrings?: boolean;
  maxLength?: number;
  maxDepth?: number;
  maxItems?: number;
};

const defaults: Required<DisplayValueOptions> = {
  quoteStrings: false,
  maxLength: 120,
  maxDepth: 2,
  maxItems: 8,
};

/** Formats unknown values without unbounded recursion or serialization work. */
export function formatDisplayValue(value: unknown, options: DisplayValueOptions = {}): string {
  const settings = {...defaults, ...options};
  if (typeof value === "string") {
    const text = shorten(value, settings.maxLength);
    return settings.quoteStrings ? JSON.stringify(text) : text;
  }
  if (value === null || value === undefined) return String(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value !== "object") return shorten(String(value), settings.maxLength);

  try {
    const summarized = summarize(value, 0, settings, new WeakSet<object>());
    return shorten(JSON.stringify(summarized), settings.maxLength);
  } catch {
    return "[unserializable]";
  }
}

function summarize(
  value: unknown,
  depth: number,
  settings: Required<DisplayValueOptions>,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "bigint") return String(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= settings.maxDepth) return Array.isArray(value) ? "[…]" : "{…}";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, settings.maxItems).map(item => summarize(item, depth + 1, settings, seen));
      if (value.length > settings.maxItems) items.push(`… ${value.length - settings.maxItems} more`);
      return items;
    }

    const result: Record<string, unknown> = {};
    let included = 0;
    let hasMore = false;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (included >= settings.maxItems) {
        hasMore = true;
        break;
      }
      result[key] = summarize((value as Record<string, unknown>)[key], depth + 1, settings, seen);
      included++;
    }
    if (hasMore) result["…"] = "more";
    return result;
  } finally {
    seen.delete(value);
  }
}

function shorten(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}
