import {spawn} from "node:child_process";
import {StringDecoder} from "node:string_decoder";
import {BoundedTextBuffer} from "../../../shared/boundedText";

export type ProcessResult = {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    cancelled: boolean;
    spawnError?: string;
    /** Failure while delivering stdin; EPIPE is omitted because early stdin closure is normal. */
    stdinError?: string;
};

/** Injectable only to make process lifecycle races deterministic in tests. */
export type ProcessRuntime = {
    spawn: typeof spawn;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    /** Optional seams for deterministic POSIX process-group tests. */
    platform?: NodeJS.Platform;
    processKill?: (pid: number, signal: NodeJS.Signals) => boolean;
};

const defaultRuntime: ProcessRuntime = {spawn, setTimeout, clearTimeout};

export function runProcess(
    proc: { command: string; args: string[]; cwd: string },
    stdin: string | undefined,
    timeoutSeconds: number,
    signal?: AbortSignal,
    runtime: ProcessRuntime = defaultRuntime,
): Promise<ProcessResult> {
    if (signal?.aborted) return Promise.resolve(emptyResult({cancelled: true}));

    return new Promise<ProcessResult>((resolve) => {
        let child: ReturnType<typeof spawn> | undefined;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let escalation: ReturnType<typeof setTimeout> | undefined;
        let forcedSettlement: ReturnType<typeof setTimeout> | undefined;
        let stdinSettlementFallback: ReturnType<typeof setTimeout> | undefined;
        let termination: "cancelled" | "timedOut" | undefined;
        let stdinError: string | undefined;
        let terminationStarted = false;
        let stdinDeliveryComplete = false;
        let closeReceived = false;
        let closeCode: number | null = null;
        let settled = false;

        const stdout = new BoundedTextBuffer(maxCapturedCharacters);
        const stderr = new BoundedTextBuffer(maxCapturedCharacters);
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");

        const clearTimer = (timer: ReturnType<typeof setTimeout> | undefined) => {
            if (timer !== undefined) runtime.clearTimeout(timer);
        };
        const cleanup = () => {
            clearTimer(timeout);
            clearTimer(escalation);
            clearTimer(forcedSettlement);
            clearTimer(stdinSettlementFallback);
            signal?.removeEventListener("abort", abort);
        };
        const finish = (exitCode: number | null, spawnError?: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            stdout.append(stdoutDecoder.end());
            stderr.append(stderrDecoder.end());
            resolve({
                stdout: stdout.value(),
                stderr: stderr.value(),
                exitCode,
                timedOut: termination === "timedOut",
                cancelled: termination === "cancelled",
                spawnError,
                stdinError,
            });
        };
        const unref = (timer: ReturnType<typeof setTimeout>) => {
            if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
        };
        const kill = (signalName: NodeJS.Signals) => {
            if (!child || settled) return;
            const platform = runtime.platform ?? process.platform;
            // A detached POSIX child leads its own process group, so signal the group
            // to catch descendants without invoking a shell. Windows has no analogous
            // safe primitive here (it would require Job Objects), so only the direct
            // child is terminated there.
            if (platform !== "win32" && typeof child.pid === "number") {
                try {
                    const processKill = runtime.processKill ?? process.kill;
                    if (processKill(-child.pid, signalName)) return;
                } catch {
                    // The group may already be gone or unavailable; try the direct child.
                }
            }
            try {
                child.kill(signalName);
            } catch {
                // Escalation and forced settlement still run when signaling fails.
            }
        };
        const beginTermination = () => {
            if (!child || settled || terminationStarted) return;
            terminationStarted = true;
            kill("SIGTERM");
            if (settled) return;
            escalation = runtime.setTimeout(() => {
                kill("SIGKILL");
                if (settled) return;
                // Some child implementations never emit close after failed signaling.
                // Do not leave the caller pending forever once escalation has completed.
                forcedSettlement = runtime.setTimeout(() => finish(null), killSettlementMilliseconds);
                unref(forcedSettlement);
            }, killEscalationMilliseconds);
            unref(escalation);
        };
        const requestTermination = (reason: "cancelled" | "timedOut") => {
            if (settled || termination) return;
            termination = reason;
            beginTermination();
        };
        const abort = () => requestTermination("cancelled");

        // Register before spawning, then check again. This closes the window between
        // the pre-abort check and obtaining the child without ever spawning a
        // process for a signal which is already aborted.
        signal?.addEventListener("abort", abort, {once: true});
        if (signal?.aborted) {
            cleanup();
            resolve(emptyResult({cancelled: true}));
            return;
        }

        try {
            child = runtime.spawn(proc.command, proc.args, {
                cwd: proc.cwd,
                shell: false,
                stdio: ["pipe", "pipe", "pipe"],
                detached: (runtime.platform ?? process.platform) !== "win32",
            });
        } catch (error) {
            cleanup();
            resolve(emptyResult({spawnError: errorMessage(error)}));
            return;
        }

        child.stdout?.on("data", (chunk: Buffer | string) => appendDecoded(stdout, stdoutDecoder, chunk));
        child.stderr?.on("data", (chunk: Buffer | string) => appendDecoded(stderr, stderrDecoder, chunk));

        stdinDeliveryComplete = child.stdin == null;
        const completeStdinDelivery = (error?: unknown) => {
            if (error && !isErrno(error, "EPIPE")) stdinError = errorMessage(error);
            stdinDeliveryComplete = true;
            if (closeReceived) finish(closeCode);
        };
        child.stdin?.once("finish", () => completeStdinDelivery());
        // Keep an error listener installed after settlement: a late stream error must
        // not become an uncaught EventEmitter error, even when it can no longer
        // affect the returned result.
        child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
            if (!settled) completeStdinDelivery(error);
        });
        child.once("error", (error) => finish(null, termination ? undefined : error.message));
        child.once("close", (code) => {
            if (settled) return;
            closeReceived = true;
            closeCode = code;
            if (stdinDeliveryComplete) {
                finish(code);
                return;
            }
            // Child close and writable failure can be delivered in either order. Give
            // stdin a bounded chance to report its outcome, but never trust an
            // ill-behaved/non-closing stream to settle the process promise.
            stdinSettlementFallback = runtime.setTimeout(() => finish(code), stdinSettlementMilliseconds);
            unref(stdinSettlementFallback);
        });

        if (termination) beginTermination();
        else {
            timeout = runtime.setTimeout(() => requestTermination("timedOut"), timeoutSeconds * 1000);
            unref(timeout);
        }

        try {
            child.stdin?.end(stdin);
        } catch (error) {
            completeStdinDelivery(error);
        }
    });
}

export function firstLine(value: string): string | undefined {
    return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function appendDecoded(buffer: BoundedTextBuffer, decoder: StringDecoder, chunk: Buffer | string): void {
    if (typeof chunk === "string") buffer.append(chunk);
    else buffer.append(decoder.write(chunk));
}

function emptyResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
    return {stdout: "", stderr: "", exitCode: null, timedOut: false, cancelled: false, ...overrides};
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isErrno(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

const maxCapturedCharacters = 50_000;
const killEscalationMilliseconds = 2_000;
const killSettlementMilliseconds = 2_000;
const stdinSettlementMilliseconds = 25;
