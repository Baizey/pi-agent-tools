import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {agentEnv, denyByDefaultEnv} from "../../shared/env";
import {policyDefaultsEnvForSubagents} from "../policy/defaults";
import {
  readSubagentTreeContext,
  renderSubagentRunTree,
  subagentNodeStatuses,
  subagentTreeEnv,
} from "./tree-ui";
import {
  ResolvedSubagentToolkits,
  SubagentToolkit,
  SubagentRunMode,
  resolveSubagentToolkits,
  serializeSubagentToolkitCeiling,
} from "./toolkits";
import {database_filename, SqliteDatabase, SubagentDao, type SubagentRunRow} from "../../storage";

export type SubagentRequest = {
  mode: SubagentRunMode;
  task: string;
  toolkits: SubagentToolkit[];
  cwd: string;
  timeoutSeconds: number;
  model?: string;
  systemPrompt?: string;
  contextPaths?: string[];
  treeNodeId?: string;
  treeRootId?: string;
  treeParentId?: string;
  treeDepth?: number;
  rootSessionId?: string;
};

export type SubagentUpdate = (partial: {content: Array<{type: "text"; text: string}>; details?: Record<string, unknown>}) => void;

export type SubagentResult = {
  mode: SubagentRunMode;
  output: string;
  exitCode: number;
  timedOut: boolean;
  stderr: string;
  messages: unknown[];
  toolkits: ResolvedSubagentToolkits;
  tree?: string[];
};

export async function runSubagent(
  request: SubagentRequest,
  signal?: AbortSignal,
  onUpdate?: SubagentUpdate,
): Promise<SubagentResult> {
  switch (request.mode) {
    case "sync":
    case "async":
    case "conversation":
      return runSubagentProcess(request, signal, onUpdate);
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
  const resolvedToolkits = resolveSubagentToolkits(request.toolkits);
  const inheritedTree = readSubagentTreeContext();
  const db = SqliteDatabase.readwrite(database_filename);
  const subagents = new SubagentDao(db).initializeSchema();
  const nodeIdentity = resolveNodeIdentity(request, inheritedTree, subagents);
  const node = subagents.startRun({
    id: nodeIdentity.id,
    parentId: nodeIdentity.parentId,
    rootId: nodeIdentity.rootId,
    ordinal: nodeIdentity.ordinal,
    depth: nodeIdentity.depth,
    mode: request.mode,
    task: request.task,
    toolkits: request.toolkits,
    tools: resolvedToolkits.tools,
  });
  const renderTree = () => renderSubagentRunTree(subagents.listTree(node.rootId), node.id);
  const emitTreeUpdate = () => onUpdate?.({
    content: [{type: "text", text: renderTree().join("\n")}],
    details: {rootId: node.rootId, nodeId: node.id},
  });

  subagents.updateRun(node.id, {status: subagentNodeStatuses.running});
  emitTreeUpdate();

  const prompt = buildSubagentPrompt(request, resolvedToolkits);
  const temp = await writeTempPrompt(prompt);
  const args = buildPiArgs(request, resolvedToolkits, temp.filePath);

  try {
    const result = await runPiProcess(args, request, resolvedToolkits, node, subagents, emitTreeUpdate, signal);
    subagents.finishRun(
      node.id,
      result.timedOut ? subagentNodeStatuses.timedOut : result.exitCode === 0 ? subagentNodeStatuses.done : subagentNodeStatuses.failed,
      {latestLine: result.output, exitCode: result.exitCode, timedOut: result.timedOut, error: result.exitCode === 0 && !result.timedOut ? null : result.stderr || result.output},
    );
    emitTreeUpdate();
    return {...result, tree: renderTree()};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    subagents.finishRun(node.id, subagentNodeStatuses.failed, {latestLine: message, error: message});
    emitTreeUpdate();
    throw error;
  } finally {
    await fs.rm(temp.dir, {recursive: true, force: true});
    db.close();
  }
}

function resolveNodeIdentity(
  request: SubagentRequest,
  inheritedTree: {rootId?: string; parentId?: string; nodeId?: string; depth: number},
  subagents: SubagentDao,
): {id: string; parentId: string | undefined; rootId: string; ordinal: number; depth: number} {
  if (request.treeNodeId) {
    const rootId = request.treeRootId ?? request.rootSessionId ?? request.treeNodeId;
    return {
      id: request.treeNodeId,
      parentId: request.treeParentId,
      rootId,
      ordinal: ordinalFromId(request.treeNodeId),
      depth: request.treeDepth ?? 0,
    };
  }

  const parentId = inheritedTree.nodeId;
  const rootId = inheritedTree.rootId ?? request.rootSessionId ?? `subagent-${process.pid}-${Date.now()}`;
  const ordinal = subagents.nextOrdinal(parentId ?? null, rootId);
  const id = parentId ? `${parentId}-${ordinal}` : `${rootId}-${ordinal}`;
  return {id, parentId, rootId, ordinal, depth: parentId ? inheritedTree.depth + 1 : 0};
}

function ordinalFromId(id: string): number {
  const suffix = id.split("-").pop();
  const ordinal = Number(suffix);
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : 1;
}

function buildPiArgs(request: SubagentRequest, toolkits: ResolvedSubagentToolkits, promptPath: string): string[] {
  const args = ["--mode", "json", "-p", "--no-session", "--append-system-prompt", promptPath];
  if (request.model) args.push("--model", request.model);
  if (toolkits.tools.length > 0) args.push("--tools", toolkits.tools.join(","));
  else args.push("--tools", "");
  args.push(`Task: ${request.task}`);
  return args;
}

function buildSubagentPrompt(request: SubagentRequest, toolkits: ResolvedSubagentToolkits): string {
  return [
    "You are a scoped subagent running for a parent coding agent.",
    "Return a concise answer to the delegated task. Do not mention implementation details of being spawned unless relevant.",
    "You cannot request additional interactive permissions. If a policy blocks access, report what was blocked and continue with available information.",
    "Run mode: " + request.mode,
    "Active toolkits: " + (toolkits.toolkits.length > 0 ? toolkits.toolkits.join(", ") : "(none)"),
    "Toolkit instructions:",
    ...toolkits.instructions.map((instruction) => `- ${instruction}`),
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
  toolkits: ResolvedSubagentToolkits,
  node: Pick<SubagentRunRow, "id" | "rootId" | "parentId" | "depth">,
  subagents: SubagentDao,
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
        ...policyDefaultsEnvForSubagents(),
        ...subagentTreeEnv({rootId: node.rootId, parentId: node.parentId ?? undefined, nodeId: node.id, depth: node.depth}),
        [agentEnv.subagentToolkitCeiling]: serializeSubagentToolkitCeiling(toolkits.toolkits),
      },
    });

    const messages: unknown[] = [];
    let stdout = "";
    let stderr = "";
    let output = "";
    let timedOut = false;
    const seenToolCalls = new Set<string>();
    let settled = false;

    const finish = (result: Omit<SubagentResult, "mode" | "toolkits">): void => {
      settled = true;
      clearTimeout(timeout);
      clearInterval(pollTree);
      signal?.removeEventListener("abort", abort);
      resolve({...result, mode: request.mode, toolkits});
    };

    const pollTree = setInterval(emitTreeUpdate, 250);
    pollTree.unref();

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
        if (toolCall && !seenToolCalls.has(toolCall.key)) {
          seenToolCalls.add(toolCall.key);
          subagents.updateRun(node.id, {latestLine: `→ ${toolCall.name}`});
          emitTreeUpdate();
        }
        const text = textFromMessage(event.message);
        if (text) {
          output = text;
          subagents.updateRun(node.id, {latestLine: lastLine(text)});
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

function toolCallFromMessage(message: unknown): {key: string; name: string; task: string; mode: "sync" | "async" | "conversation"} | null {
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
      const args = "arguments" in part && part.arguments && typeof part.arguments === "object"
        ? part.arguments as Record<string, unknown>
        : {};
      const mode = args.mode === "async" || args.mode === "conversation" ? args.mode : "sync";
      const explicitId = "id" in part && typeof part.id === "string" ? part.id : undefined;
      const key = explicitId ?? `${part.name}:${JSON.stringify(args)}`;
      return {key, name: part.name, task: typeof args.task === "string" ? args.task : part.name, mode};
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
