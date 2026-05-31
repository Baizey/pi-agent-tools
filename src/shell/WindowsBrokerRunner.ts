import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { FsAccessType } from "../policy/types";

export type BrokerAccessRequest = {
  id: string;
  pid?: number;
  operation?: string;
  path: string;
  accessType: string;
};

export type BrokerDecision = {
  allowed: boolean;
  reason?: string;
};

export type BrokerRunOptions = {
  command: string;
  cwd: string;
  timeoutMs?: number;
  shell?: "powershell" | "pwsh" | "cmd";
  onAccessRequest(request: BrokerAccessRequest): Promise<BrokerDecision>;
};

export type BrokerRunResult = {
  output: string;
  exitCode: number;
  cancelled: boolean;
  truncated: boolean;
};

export class WindowsBrokerRunner {
  static brokerPath(): string {
    return "C:/repositories/pidev/dependencies/windows_broker.exe";
  }

  async run(options: BrokerRunOptions): Promise<BrokerRunResult> {
    if (process.platform !== "win32") {
      return this.failed("Windows broker shell policy is only supported on Windows.");
    }

    const brokerPath = WindowsBrokerRunner.brokerPath();
    if (!fs.existsSync(brokerPath)) {
      return this.failed(`Windows broker executable not found: ${brokerPath}`);
    }

    const output: string[] = [];
    let exitCode = 1;
    let cancelled = false;
    let sawExitMessage = false;
    let deniedReason: string | undefined;

    const child = spawn(brokerPath, [
      "--command", options.command,
      "--cwd", options.cwd,
      "--shell", options.shell ?? "powershell",
      "--timeout-ms", String(options.timeoutMs ?? 0),
      "--decision-timeout-ms", "300000",
      "--default-decision", "deny",
    ], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stderr = readline.createInterface({ input: child.stderr });
    stderr.on("line", (line) => output.push(line));

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      void this.handleLine(line, child.stdin, output, options.onAccessRequest).then((result) => {
        if (!result) return;
        if (result.type === "exit") {
          sawExitMessage = true;
          exitCode = result.exitCode;
          cancelled = result.cancelled;
          if (result.deniedReason) deniedReason = result.deniedReason;
        }
        if (result.type === "denied" && result.reason) deniedReason = result.reason;
      });
    });

    const processExitCode = await new Promise<number>((resolve) => {
      child.on("error", (error) => {
        output.push(`Failed to start Windows broker: ${error.message}`);
        resolve(1);
      });
      child.on("close", (code) => resolve(code ?? 1));
    });

    stdout.close();
    stderr.close();

    if (!sawExitMessage) exitCode = processExitCode;
    if (deniedReason) {
      const reason = deniedReason;
      if (!output.some((line) => line.includes(reason))) output.push(reason);
    }

    return {
      output: output.join(""),
      exitCode,
      cancelled,
      truncated: false,
    };
  }

  private async handleLine(
    line: string,
    stdin: NodeJS.WritableStream,
    output: string[],
    onAccessRequest: BrokerRunOptions["onAccessRequest"],
  ): Promise<{ type: "exit"; exitCode: number; cancelled: boolean; deniedReason?: string } | { type: "denied"; reason?: string } | null> {
    let message: { type?: string; payload?: unknown };
    try {
      message = JSON.parse(line) as { type?: string; payload?: unknown };
    } catch {
      output.push(`${line}\n`);
      return null;
    }

    const payload = message.payload as Record<string, unknown> | undefined;

    switch (message.type) {
      case "stdout":
      case "stderr":
        if (typeof payload?.data === "string") output.push(payload.data);
        return null;

      case "warning":
      case "error":
        if (typeof payload?.message === "string") output.push(`${payload.message}\n`);
        if (typeof payload?.detail === "string") output.push(`${payload.detail}\n`);
        return null;

      case "accessRequest": {
        const request = this.parseAccessRequest(payload);
        if (!request) return null;

        const decision = await onAccessRequest(request);
        stdin.write(`${JSON.stringify({ type: "accessDecision", id: request.id, allowed: decision.allowed })}\n`);
        return decision.allowed ? null : { type: "denied", reason: decision.reason };
      }

      case "exit":
        return {
          type: "exit",
          exitCode: numberValue(payload?.exitCode, 1),
          cancelled: booleanValue(payload?.cancelled, false),
          deniedReason: typeof payload?.deniedReason === "string" ? payload.deniedReason : undefined,
        };

      default:
        return null;
    }
  }

  private parseAccessRequest(payload: Record<string, unknown> | undefined): BrokerAccessRequest | null {
    if (!payload) return null;
    if (typeof payload.id !== "string" || typeof payload.path !== "string" || typeof payload.accessType !== "string") return null;
    return {
      id: payload.id,
      pid: typeof payload.pid === "number" ? payload.pid : undefined,
      operation: typeof payload.operation === "string" ? payload.operation : undefined,
      path: payload.path,
      accessType: payload.accessType,
    };
  }

  private failed(message: string): BrokerRunResult {
    return {
      output: `${message}\n`,
      exitCode: 1,
      cancelled: false,
      truncated: false,
    };
  }
}

export function brokerAccessType(value: string): FsAccessType | null {
  switch (value) {
    case FsAccessType.READ:
    case FsAccessType.WRITE:
    case FsAccessType.EDIT:
    case FsAccessType.DELETE:
    case FsAccessType.EXECUTE:
      return value;
    default:
      return null;
  }
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
