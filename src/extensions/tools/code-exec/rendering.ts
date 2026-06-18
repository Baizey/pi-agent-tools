import {renderBlockToolCall} from "../../../shared/blockToolRendering";
import {toolNames} from "../../../shared/toolNames";
import {renderToolCallInput} from "../../../shared/toolRendering";
import {stringValue} from "../../../shared/values";
import {ExecInput, RuntimeInfo} from "./types";
import {ProcessResult} from "./process";

export function renderCodeExecCall(args: Record<string, unknown>, theme?: unknown, context?: unknown) {
  const code = stringValue((args as ExecInput).code);
  if (!code) return renderToolCallInput(toolNames.executeCode, args, theme as never);
  return renderBlockToolCall(
    toolNames.executeCode,
    [
      `  language: ${stringValue((args as ExecInput).language) ?? "<missing>"}`,
      stringValue((args as ExecInput).purpose) ? `  purpose: ${stringValue((args as ExecInput).purpose)}` : null,
      "  mode: inline",
      Array.isArray((args as ExecInput).args) ? `  args: ${JSON.stringify((args as ExecInput).args)}` : null,
      stringValue((args as ExecInput).cwd) ? `  cwd: ${stringValue((args as ExecInput).cwd)}` : null,
    ],
    "code",
    code,
    context as {expanded?: boolean} | undefined,
  );
}

export function formatRuntimeInfo(runtimes: RuntimeInfo[]): string {
  return runtimes.map((runtime) => {
    const status = runtime.available ? "available" : "unavailable";
    return [
      `${runtime.language}: ${status}`,
      runtime.executable ? `  executable: ${runtime.executable}` : "",
      runtime.version ? `  version: ${runtime.version}` : "",
      `  modes: ${runtime.modes.join(", ")}`,
      runtime.notes && runtime.notes.length > 0 ? `  notes: ${runtime.notes.join("; ")}` : "",
      runtime.error ? `  error: ${runtime.error}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

export function formatRunSummary(run: ProcessResult): string {
  return [
    `Exit code: ${run.exitCode}${run.timedOut ? " (timed out)" : ""}`,
    run.stdout ? `STDOUT:\n${run.stdout}` : "",
    run.stderr ? `STDERR:\n${run.stderr}` : "",
  ].filter(Boolean).join("\n");
}
