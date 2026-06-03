import fs from "node:fs";
import path from "node:path";

export function standardizePath(cwd: string, input: string): string {
  return resolvePhysicalPath(path.resolve(cwd, input));
}

export function resolvePhysicalPath(input: string): string {
  const normalized = path.resolve(input).normalize().replace(/[\\/]+$/g, "");
  const existingAncestor = nearestExistingAncestor(normalized);
  if (!existingAncestor) return normalized;

  try {
    const physicalAncestor = fs.realpathSync.native(existingAncestor).replace(/[\\/]+$/g, "");
    const suffix = path.relative(existingAncestor, normalized);
    return suffix ? path.join(physicalAncestor, suffix).normalize().replace(/[\\/]+$/g, "") : physicalAncestor;
  } catch {
    return normalized;
  }
}

function nearestExistingAncestor(input: string): string | null {
  let current = input;
  while (true) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
