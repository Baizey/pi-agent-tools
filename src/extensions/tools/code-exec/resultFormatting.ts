import type {TextToolResult} from "../../../shared/toolResults";
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

export function formatProcessOutcome(stage: "compile" | "run", result: ProcessResult): {
    text: string;
    isError: boolean
} {
    const label = stage === "compile" ? "Compilation" : "Execution";
    if (result.cancelled) return {text: `${label} cancelled.${capturedOutput(result)}`, isError: true};
    if (result.timedOut) return {text: `${label} timed out.${capturedOutput(result)}`, isError: true};
    if (result.spawnError) return {
        text: `${label} could not start: ${result.spawnError}${capturedOutput(result)}`,
        isError: true
    };
    if (result.stdinError) return {
        text: `${label} failed while writing stdin: ${result.stdinError}${capturedOutput(result)}`,
        isError: true
    };
    if (result.exitCode !== 0) {
        const heading = stage === "compile" ? "Compilation failed." : `Execution failed with exit code ${result.exitCode}.`;
        return {text: `${heading}${capturedOutput(result)}`, isError: true};
    }
    return {text: formatRunSummary(result), isError: false};
}

export function withCleanupFailure(result: TextToolResult, cleanupError: string): TextToolResult {
    const text = (result.content[0] as { type: "text"; text: string } | undefined)?.text ?? "";
    return {
        ...result,
        content: [{type: "text", text: `${text}\n\nTemporary artifact cleanup failed: ${cleanupError}`}],
        details: {...result.details, cleanupError, error: true},
        isError: true,
    };
}

function capturedOutput(result: ProcessResult): string {
    const output = presentLines([
        result.stdout ? `STDOUT:\n${result.stdout}` : undefined,
        result.stderr ? `STDERR:\n${result.stderr}` : undefined,
    ]).join("\n");
    return output ? `\n${output}` : "";
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
