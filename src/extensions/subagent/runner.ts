import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {denyByDefaultEnv} from "../../shared/env";
import {ResolvedSubagentProfiles, SubagentProfile, resolveSubagentProfiles} from "./profiles";

export type SyncSubagentInput = {
  task: string;
  profiles: SubagentProfile[];
  cwd: string;
  timeoutSeconds: number;
  systemPrompt?: string;
  contextPaths?: string[];
};

export type SyncSubagentResult = {
  output: string;
  exitCode: number;
  timedOut: boolean;
  stderr: string;
  messages: unknown[];
  profiles: ResolvedSubagentProfiles;
};

export async function runSyncSubagent(input: SyncSubagentInput, signal?: AbortSignal): Promise<SyncSubagentResult> {
  const resolvedProfiles = resolveSubagentProfiles(input.profiles);
  const prompt = buildSubagentPrompt(input, resolvedProfiles);
  const temp = await writeTempPrompt(prompt);
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--append-system-prompt",
    temp.filePath,
    "--tools",
    resolvedProfiles.tools.join(","),
    `Task: ${input.task}`,
  ];

  try {
    return await runPiProcess(args, input.cwd, input.timeoutSeconds, resolvedProfiles, signal);
  } finally {
    await fs.rm(temp.dir, {recursive: true, force: true});
  }
}

function buildSubagentPrompt(input: SyncSubagentInput, profiles: ResolvedSubagentProfiles): string {
  return [
    "You are a scoped subagent running for a parent coding agent.",
    "Return a concise answer to the delegated task. Do not mention implementation details of being spawned unless relevant.",
    "You cannot request additional interactive permissions. If a policy blocks access, report what was blocked and continue with available information.",
    "Active profiles: " + profiles.profiles.join(", "),
    "Profile instructions:",
    ...profiles.instructions.map((instruction) => `- ${instruction}`),
    input.contextPaths && input.contextPaths.length > 0
      ? `Context paths suggested by parent: ${input.contextPaths.join(", ")}`
      : "",
    input.systemPrompt ?? "",
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
  cwd: string,
  timeoutSeconds: number,
  profiles: ResolvedSubagentProfiles,
  signal?: AbortSignal,
): Promise<SyncSubagentResult> {
  return new Promise((resolve) => {
    const invocation = getPiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd,
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

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) proc.kill("SIGKILL");
      }, 5000).unref();
    }, Math.max(1, timeoutSeconds) * 1000);
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
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (stdout.trim()) processLine(stdout);
      resolve({
        output: output || stderr || "(no output)",
        exitCode: code ?? 0,
        timedOut,
        stderr,
        messages,
        profiles,
      });
    });

    proc.on("error", (error) => {
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve({
        output: error.message,
        exitCode: 1,
        timedOut,
        stderr: error.message,
        messages,
        profiles,
      });
    });
  });
}

function textFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return null;
  const content = "content" in message ? message.content : undefined;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
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
