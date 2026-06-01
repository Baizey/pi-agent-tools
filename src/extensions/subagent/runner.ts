import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {agentEnv, denyByDefaultEnv} from "../../shared/env";
import {toolNames} from "../../shared/toolNames";
import {
  cleanupSubagentTreeDir,
  finishSubagentNode,
  readSubagentTreeContext,
  renderSubagentTreeFor,
  renderSubagentTreeFromFiles,
  startSubagentNode,
  subagentNodeStatuses,
  subagentTreeEnv,
  updateSubagentNode,
  writeSubagentNodeFile,
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
  treeDir?: string;
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
  const resolvedProfiles = resolveSubagentProfiles(request.profiles);
  const inheritedTree = readSubagentTreeContext();
  const treeDir = request.treeDir ?? inheritedTree.treeDir ?? await fs.mkdtemp(path.join(os.tmpdir(), "pi-agent-subagent-tree-"));
  const shouldCleanupTreeDir = !request.treeDir && !inheritedTree.treeDir;
  const nodeIdentity = resolveNodeIdentity(request, inheritedTree);
  const node = startSubagentNode({
    id: nodeIdentity.id,
    parentId: nodeIdentity.parentId,
    rootId: nodeIdentity.rootId,
    depth: nodeIdentity.depth,
    mode: request.mode,
    task: request.task,
    profiles: request.profiles,
    tools: resolvedProfiles.tools,
  });
  const renderTree = () => {
    const fileTree = renderSubagentTreeFromFiles(treeDir, node.rootId);
    return fileTree.length > 0 ? fileTree : renderSubagentTreeFor(node.rootId);
  };
  const emitTreeUpdate = () => onUpdate?.({
    content: [{type: "text", text: renderTree().join("\n")}],
    details: {rootId: node.rootId, nodeId: node.id, treeDir},
  });
  let publishQueue = Promise.resolve();
  const publishNode = async () => {
    publishQueue = publishQueue
      .catch(() => undefined)
      .then(() => writeSubagentNodeFile(treeDir, node))
      .catch(() => undefined);
    await publishQueue;
  };
  const settlePendingPublishes = async () => {
    await publishQueue.catch(() => undefined);
  };

  updateSubagentNode(node.id, {status: subagentNodeStatuses.running});
  await publishNode();
  emitTreeUpdate();

  const prompt = buildSubagentPrompt(request, resolvedProfiles);
  const temp = await writeTempPrompt(prompt);
  const args = buildPiArgs(request, resolvedProfiles, temp.filePath);

  try {
    const result = await runPiProcess(args, request, resolvedProfiles, node, treeDir, publishNode, emitTreeUpdate, signal);
    finishSubagentNode(
      node.id,
      result.timedOut ? subagentNodeStatuses.timedOut : result.exitCode === 0 ? subagentNodeStatuses.done : subagentNodeStatuses.failed,
      result.output,
    );
    await publishNode();
    emitTreeUpdate();
    return {...result, tree: renderTree()};
  } catch (error) {
    finishSubagentNode(node.id, subagentNodeStatuses.failed, error instanceof Error ? error.message : String(error));
    await publishNode();
    emitTreeUpdate();
    throw error;
  } finally {
    await settlePendingPublishes();
    await fs.rm(temp.dir, {recursive: true, force: true});
    if (shouldCleanupTreeDir) await cleanupSubagentTreeDir(treeDir);
  }
}

function resolveNodeIdentity(
  request: SubagentRequest,
  inheritedTree: {rootId?: string; parentId?: string; nodeId?: string; depth: number},
): {id: string | undefined; parentId: string | undefined; rootId: string | undefined; depth: number | undefined} {
  if (request.treeNodeId) {
    return {
      id: request.treeNodeId,
      parentId: request.treeParentId,
      rootId: request.treeRootId,
      depth: request.treeDepth,
    };
  }

  if (inheritedTree.nodeId) {
    return {
      id: undefined,
      parentId: inheritedTree.nodeId,
      rootId: inheritedTree.rootId,
      depth: inheritedTree.depth + 1,
    };
  }

  return {id: undefined, parentId: undefined, rootId: undefined, depth: undefined};
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
  treeDir: string,
  publishNode: () => Promise<void>,
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
        ...subagentTreeEnv({rootId: node.rootId, parentId: node.parentId, nodeId: node.id, depth: node.depth, treeDir}),
        [agentEnv.subagentProfileCeiling]: serializeSubagentProfileCeiling(profiles.profiles),
      },
    });

    const messages: unknown[] = [];
    let stdout = "";
    let stderr = "";
    let output = "";
    let timedOut = false;
    const shadowSubagents: string[] = [];
    const seenToolCalls = new Set<string>();
    let settled = false;

    const finish = (result: Omit<SubagentResult, "mode" | "profiles">): void => {
      settled = true;
      clearTimeout(timeout);
      clearInterval(pollTree);
      signal?.removeEventListener("abort", abort);
      resolve({...result, mode: request.mode, profiles});
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
          updateSubagentNode(node.id, {latestLine: `→ ${toolCall.name}`});
          void publishNode();
          if (toolCall.name === toolNames.subagentSpawn) {
            const child = startSubagentNode({
              parentId: node.id,
              rootId: node.rootId,
              depth: node.depth + 1,
              mode: toolCall.mode,
              task: toolCall.task,
              profiles: [],
              tools: [],
            });
            updateSubagentNode(child.id, {status: subagentNodeStatuses.running});
            shadowSubagents.push(child.id);
          }
          emitTreeUpdate();
        }
        const toolResult = toolResultFromMessage(event.message);
        if (toolResult && shadowSubagents.length > 0) {
          const childId = shadowSubagents.shift() as string;
          finishSubagentNode(
            childId,
            toolResult.isError ? subagentNodeStatuses.failed : subagentNodeStatuses.done,
            toolResult.text ?? "completed",
          );
          emitTreeUpdate();
        }
        const text = textFromMessage(event.message);
        if (text) {
          output = text;
          updateSubagentNode(node.id, {latestLine: lastLine(text)});
          void publishNode();
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
      for (const childId of shadowSubagents) finishSubagentNode(childId, subagentNodeStatuses.done, "completed");
      if (shadowSubagents.length > 0) emitTreeUpdate();
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

function toolResultFromMessage(message: unknown): {text?: string; isError: boolean} | null {
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== "toolResult") return null;
  const content = "content" in message ? message.content : undefined;
  const isError = "isError" in message && message.isError === true;
  if (!Array.isArray(content)) return {isError};
  for (const part of content) {
    if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
      return {text: lastLine(part.text), isError};
    }
  }
  return {isError};
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
