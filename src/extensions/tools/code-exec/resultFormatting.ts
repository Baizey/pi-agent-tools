import type {ProcessResult} from "./process";
import type {RuntimeInfo} from "./types";

export function formatRuntimeInfo(runtimes: RuntimeInfo[]): string {
  return runtimes.map(formatRuntime).join("\n\n");
}

export function formatRunSummary(run: ProcessResult): string {
  return presentLines([
    `Exit code: ${run.exitCode}${run.timedOut ? " (timed out)" : ""}`,
    run.stdout ? `STDOUT:\n${run.stdout}` : undefined,
    run.stderr ? `STDERR:\n${run.stderr}` : undefined,
  ]).join("\n");
}

function formatRuntime(runtime: RuntimeInfo): string {
  return presentLines([
    `${runtime.language}: ${runtime.available ? "available" : "unavailable"}`,
    runtime.executable ? `  executable: ${runtime.executable}` : undefined,
    runtime.version ? `  version: ${runtime.version}` : undefined,
    `  modes: ${runtime.modes.join(", ")}`,
    runtime.notes?.length ? `  notes: ${runtime.notes.join("; ")}` : undefined,
    runtime.error ? `  error: ${runtime.error}` : undefined,
  ]).join("\n");
}

function presentLines(lines: Array<string | undefined>): string[] {
  return lines.filter((line): line is string => Boolean(line));
}
