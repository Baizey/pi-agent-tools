import path from "node:path";

export function standardizePath(cwd: string, input: string): string {
  return path.resolve(cwd, input).normalize().replace(/[\\/]+$/g, "");
}
