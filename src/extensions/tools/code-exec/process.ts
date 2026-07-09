import {spawn} from "node:child_process";

export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: string;
};

export function runProcess(
  proc: {command: string; args: string[]; cwd: string},
  stdin: string | undefined,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve) => {
    let child;
    try {
      child = spawn(proc.command, proc.args, {cwd: proc.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"]});
    } catch (error) {
      resolve({stdout: "", stderr: "", exitCode: null, timedOut: false, spawnError: error instanceof Error ? error.message : String(error)});
      return;
    }

    const stdout = new BoundedOutput();
    const stderr = new BoundedOutput();
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve({stdout: stdout.value(), stderr: stderr.value(), exitCode, timedOut, spawnError});
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 2000).unref();
    }, timeoutSeconds * 1000);
    timeout.unref();
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, {once: true});

    child.stdout?.on("data", (chunk) => { stdout.append(chunk.toString()); });
    child.stderr?.on("data", (chunk) => { stderr.append(chunk.toString()); });
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
    if (stdin !== undefined) child.stdin?.end(stdin);
    else child.stdin?.end();
  });
}

export function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

const maxCapturedCharacters = 50_000;

export class BoundedOutput {
  private content = "";
  private truncated = false;

  constructor(private readonly maxCharacters = maxCapturedCharacters) {}

  append(chunk: string): void {
    const remaining = this.maxCharacters - this.content.length;
    if (remaining <= 0) {
      if (chunk.length > 0) this.truncated = true;
      return;
    }
    this.content += chunk.slice(0, remaining);
    if (chunk.length > remaining) this.truncated = true;
  }

  value(): string {
    return this.truncated ? `${this.content}\n[truncated]` : this.content;
  }
}
