import {FsAccessType} from "../../policy/types";

export type BashPathAccess = {
  path: string;
  accessType: FsAccessType;
};

export function bashPathAccesses(command: string): BashPathAccess[] {
  const accesses: BashPathAccess[] = [];
  for (const segment of splitBashSegments(command)) {
    accesses.push(...bashSegmentPathAccesses(segment));
  }
  return dedupeBashPathAccesses(accesses);
}

function bashSegmentPathAccesses(segment: string): BashPathAccess[] {
  const tokens = tokenizeBashSegment(segment).map((token) => token.value);
  const executable = tokens[0]?.split(/[\\/]/).pop()?.toLowerCase();
  if (!executable) return [];

  const pathArgs = tokens.slice(1).filter(isPathLikeBashArgument);
  if (["rm", "rmdir", "del", "erase"].includes(executable)) {
    return pathArgs.map((path) => ({path, accessType: FsAccessType.DELETE}));
  }

  if (["mkdir", "touch"].includes(executable)) {
    return pathArgs.map((path) => ({path, accessType: FsAccessType.WRITE}));
  }

  if (["cp", "copy", "xcopy", "robocopy"].includes(executable) && pathArgs.length >= 2) {
    return [
      ...pathArgs.slice(0, -1).map((path) => ({path, accessType: FsAccessType.READ})),
      {path: pathArgs[pathArgs.length - 1], accessType: FsAccessType.WRITE},
    ];
  }

  if (["mv", "move", "ren", "rename"].includes(executable) && pathArgs.length >= 2) {
    return [
      ...pathArgs.slice(0, -1).map((path) => ({path, accessType: FsAccessType.DELETE})),
      {path: pathArgs[pathArgs.length - 1], accessType: FsAccessType.WRITE},
    ];
  }

  return pathArgs.map((path) => ({path, accessType: FsAccessType.READ}));
}

function dedupeBashPathAccesses(accesses: BashPathAccess[]): BashPathAccess[] {
  const seen = new Set<string>();
  return accesses.filter((access) => {
    const key = `${access.accessType}\0${access.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitBashSegments(input: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  let skipNext = false;

  const flush = (): void => {
    const segment = current.trim();
    if (segment.length > 0) segments.push(segment);
    current = "";
  };

  for (let index = 0; index < input.length; index++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const char = input[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    const next = input[index + 1];
    if (char === ";" || char === "|" || char === "\n" || char === "\r") flush();
    else if (char === "&" && (next === "&" || next === "|")) {
      flush();
      skipNext = true;
    } else if (char === "&") flush();
    else current += char;
  }
  flush();
  return segments;
}

type BashToken = {
  value: string;
  quoted: boolean;
};

function tokenizeBashSegment(input: string): BashToken[] {
  const tokens: BashToken[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  let quoted = false;

  const flush = (): void => {
    if (current.length > 0 || quoted) {
      tokens.push({value: current, quoted});
      current = "";
      quoted = false;
    }
  };

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      quoted = true;
    } else if (/\s/.test(char)) flush();
    else current += char;
  }
  flush();
  return tokens;
}

function isPathLikeBashArgument(value: string): boolean {
  return value.includes("/") || value.includes("\\") || /^[a-zA-Z]:/.test(value);
}
