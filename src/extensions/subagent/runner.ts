import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {agentEnv, denyByDefaultEnv} from "../../shared/env";
import {
  finishSubagentNode,
  readSubagentTreeContext,
  renderSubagentTreeFor,
  startSubagentNode,
  subagentTreeEnv,
  updateSubagentNode,
} from "./tree-ui";
import {
  ResolvedSubagentProfiles,
  SubagentProfile,
  SubagentRunMode,
  resolveSubagentProfiles,
  serializeSubagentProfileCeiling,
} from "./profiles";

export type SubagentRequest = {
  mode: SubagentRunMode;
  task: string;
  profiles: SubagentProfile[];
  cwd: string;
  timeoutSeconds: number;
  systemPrompt?: string;
  contextPaths?: string[];
  treeNodeId?: string;
  treeRootId?: string;
  treeParentId?: string;
  treeDepth?: number;
};

export type SubagentUpdate = (partial: {content: Array<{type: "text"; text: string}>; details?: Record<string, unknown>}) => void;

export type SubagentResult = {
  mode: SubagentRunMode;
  output: string;
  exitCode: number;
  timedOut: boolean;
  stderr: string;
  messages: unknown[];
  profiles: ResolvedSubagentProfiles;
};

export async function runSubagent(
  request: SubagentRequest,
  signal?: AbortSignal,
  onUpdate?: SubagentUpdate,
): Promise<SubagentResult> {
  switch (request.mode) {
    case "sync":
    case "async":
      return runSubagentProcess(request, signal, onUpdate);
    case "conversation":
      return {
        mode: request.mode,
        output: `Subagent mode '${request.mode}' is planned but not implemented yet. Use mode 'sync' or 'async'.`,
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
  onUpdate?: SubagentUpdate,
): Promise<SubagentResult> {
  return runSubagent({...input, mode: "sync"}, signal, onUpdate);
}

async function runSubagentProcess(
  request: SubagentRequest,
  signal?: AbortSignal,
  onUpdate?: SubagentUpdate,
): Promise<SubagentResult> {
  const resolvedProfiles = resolveSubagentProfiles(request.profiles);
  const inheritedTree = readSubagentTreeContext();
  const node = startSubagentNode({
    id: request.treeNodeId ?? inheritedTree.nodeId,
    parentId: request.treeParentId ?? inheritedTree.parentId,
    rootId: request.treeRootId ?? inheritedTree.rootId,
    depth: request.treeDepth ?? inheritedTree.depth,
    mode: request.mode,
    task: request.task,
    profiles: request.profiles,
    tools: resolvedProfiles.tools,
  });
  const emitTreeUpdate = () => onUpdate?.({
    content: [{type: "text", text: renderSubagentTreeFor(node.rootId).join("\n")}],
    details: {rootId: node.rootId, nodeId: node.id},
  });

  updateSubagentNode(node.id, {status: "running"});
  emitTreeUpdate();

  const prompt = buildSubagentPrompt(request, resolvedProfiles);
  const temp = await writeTempPrompt(prompt);
  const args = buildPiArgs(request, resolvedProfiles, temp.filePath);

  try {
    const result = await runPiProcess(args, request, resolvedProfiles, node, emitTreeUpdate, signal);
    finishSubagentNode(node.id, result.timedOut ? "timed_out" : result.exitCode === 0 ? "done" : "failed", result.output);
    emitTreeUpdate();
    return result;
  } catch (error) {
    finishSubagentNode(node.id, "failed", error instanceof Error ? error.message : String(error));
    emitTreeUpdate();
    throw error;
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
  node: {id: string; rootId: string; parentId?: string; depth: number},
  emitTreeUpdate: () => void,
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
        ...subagentTreeEnv({rootId: node.rootId, parentId: node.parentId, nodeId: node.id, depth: node.depth}),
        [agentEnv.subagentProfileCeiling]: serializeSubagentProfileCeiling(profiles.profiles),
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
        const toolCall = toolCallFromMessage(event.message);
        if (toolCall) {
          updateSubagentNode(node.id, {latestLine: `→ ${toolCall}`});
          emitTreeUpdate();
        }
        const text = textFromMessage(event.message);
        if (text) {
          output = text;
          updateSubagentNode(node.id, {latestLine: lastLine(text)});
          emitTreeUpdate();
        }
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

function toolCallFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return null;
  const content = "content" in message ? message.content : undefined;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "toolCall" &&
      "name" in part &&
      typeof part.name === "string"
    ) {
      return part.name;
    }
  }
  return null;
}

function lastLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : text;
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
