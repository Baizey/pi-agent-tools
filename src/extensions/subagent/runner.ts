import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {denyByDefaultEnv} from "../../shared/env";
import {
  ResolvedSubagentProfiles,
  SubagentProfile,
  SubagentRunMode,
  resolveSubagentProfiles,
} from "./profiles";

export type SubagentRequest = {
  mode: SubagentRunMode;
  task: string;
  profiles: SubagentProfile[];
  cwd: string;
  timeoutSeconds: number;
  systemPrompt?: string;
  contextPaths?: string[];
};

export type SubagentResult = {
  mode: SubagentRunMode;
  output: string;
  exitCode: number;
  timedOut: boolean;
  stderr: string;
  messages: unknown[];
  profiles: ResolvedSubagentProfiles;
};

export async function runSubagent(request: SubagentRequest, signal?: AbortSignal): Promise<SubagentResult> {
  switch (request.mode) {
    case "sync":
      return runSubagentProcess(request, signal);
    case "async":
    case "conversation":
      return {
        mode: request.mode,
        output: `Subagent mode '${request.mode}' is planned but not implemented yet. Use mode 'sync'.`,
        exitCode: 1,
        timedOut: false,
        stderr: "",
        messages: [],
        profiles: resolveSubagentProfiles(request.profiles),
      };
  }
}

export async function runSyncSubagent(
  input: Omit<SubagentRequest, "mode">,
  signal?: AbortSignal,
): Promise<SubagentResult> {
  return runSubagent({...input, mode: "sync"}, signal);
}

async function runSubagentProcess(request: SubagentRequest, signal?: AbortSignal): Promise<SubagentResult> {
  const resolvedProfiles = resolveSubagentProfiles(request.profiles);
  const prompt = buildSubagentPrompt(request, resolvedProfiles);
  const temp = await writeTempPrompt(prompt);
  const args = buildPiArgs(request, resolvedProfiles, temp.filePath);

  try {
    return await runPiProcess(args, request, resolvedProfiles, signal);
  } finally {
    await fs.rm(temp.dir, {recursive: true, force: true});
  }
}

function buildPiArgs(request: SubagentRequest, profiles: ResolvedSubagentProfiles, promptPath: string): string[] {
  const args = ["--mode", "json", "-p", "--no-session", "--append-system-prompt", promptPath];
  if (profiles.tools.length > 0) args.push("--tools", profiles.tools.join(","));
  else args.push("--tools", "");
  args.push(`Task: ${request.task}`);
  return args;
}

function buildSubagentPrompt(request: SubagentRequest, profiles: ResolvedSubagentProfiles): string {
  return [
    "You are a scoped subagent running for a parent coding agent.",
    "Return a concise answer to the delegated task. Do not mention implementation details of being spawned unless relevant.",
    "You cannot request additional interactive permissions. If a policy blocks access, report what was blocked and continue with available information.",
    "Run mode: " + request.mode,
    "Active profiles: " + profiles.profiles.join(", "),
    "Profile instructions:",
    ...profiles.instructions.map((instruction) => `- ${instruction}`),
    request.contextPaths && request.contextPaths.length > 0
      ? `Context paths suggested by parent: ${request.contextPaths.join(", ")}`
      : "",
    request.systemPrompt ?? "",
  ].filter(Boolean).join("\n");
}

async function writeTempPrompt(prompt: string): Promise<{dir: string; filePath: string}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-agent-subagent-"));
  const filePath = path.join(dir, "system-prompt.md");
  await fs.writeFile(filePath, prompt, {encoding: "utf8", mode: 0o600});
  return {dir, filePath};
}

async function runPiProcess(
  args: string[],
  request: SubagentRequest,
  profiles: ResolvedSubagentProfiles,
  signal?: AbortSignal,
): Promise<SubagentResult> {
  return new Promise((resolve) => {
    const invocation = getPiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: request.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...denyByDefaultEnv(),
      },
    });

    const messages: unknown[] = [];
    let stdout = "";
    let stderr = "";
    let output = "";
    let timedOut = false;
    let settled = false;

    const finish = (result: Omit<SubagentResult, "mode" | "profiles">): void => {
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve({...result, mode: request.mode, profiles});
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) proc.kill("SIGKILL");
      }, 5000).unref();
    }, Math.max(1, request.timeoutSeconds) * 1000);
    timeout.unref();

    const abort = () => {
      proc.kill("SIGTERM");
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, {once: true});

    const processLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.message) messages.push(event.message);
        const text = textFromMessage(event.message);
        if (text) output = text;
      } catch {
        // Ignore non-JSON output from child process.
      }
    };

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (stdout.trim()) processLine(stdout);
      finish({
        output: output || stderr || "(no output)",
        exitCode: code ?? 0,
        timedOut,
        stderr,
        messages,
      });
    });

    proc.on("error", (error) => {
      finish({
        output: error.message,
        exitCode: 1,
        timedOut,
        stderr: error.message,
        messages,
      });
    });
  });
}

function textFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return null;
  const content = "content" in message ? message.content : undefined;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      return part.text;
    }
  }
  return null;
}

function getPiInvocation(args: string[]): {command: string; args: string[]} {
  const currentScript = process.argv[1];
  if (currentScript) return {command: process.execPath, args: [currentScript, ...args]};
  return {command: "pi", args};
}
