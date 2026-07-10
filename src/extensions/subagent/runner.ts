import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {agentEnv, denyByDefaultEnv} from "../../shared/env";
import {BoundedTextBuffer, truncateText} from "../../shared/boundedText";
import {toolNames} from "../../shared/toolNames";
import {policyDefaultsEnvForSubagents} from "../policy/defaults";
import {
  readSubagentTreeContext,
  renderSubagentRunTree,
  subagentNodeStatuses,
  subagentTreeEnv,
  subagentTreeRowLimit,
} from "./tree-ui";
import {
  ResolvedSubagentToolkits,
  SubagentToolkit,
  SubagentRunMode,
  subagentRunModes,
  resolveSubagentToolkits,
  serializeSubagentToolkitCeiling,
} from "./toolkits";
import {database_filename, SqliteDatabase, SubagentDao, type SubagentRunRow} from "../../storage";

enum AssistantMessageRole {
  assistant = "assistant",
}

enum MessagePartType {
  text = "text",
  toolCall = "toolCall",
}

enum PiJsonEventType {
  toolCall = "tool_call",
  toolExecutionStart = "tool_execution_start",
  toolExecutionUpdate = "tool_execution_update",
}

export type SubagentRequest = {
  mode: SubagentRunMode;
  task: string;
  role: string;
  persona?: string;
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
  return runSubagentProcess(request, signal, onUpdate);
}

export async function runSyncSubagent(
  input: Omit<SubagentRequest, "mode">,
  signal?: AbortSignal,
  onUpdate?: SubagentUpdate,
): Promise<SubagentResult> {
  return runSubagent({...input, mode: subagentRunModes.sync}, signal, onUpdate);
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
    role: request.role,
    persona: request.persona,
    toolkits: request.toolkits,
    tools: resolvedToolkits.tools,
  });
  const renderTree = () => renderSubagentRunTree(
    subagents.listTree(node.rootId, subagentTreeRowLimit + 1),
    node.id,
  );
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
      {latestLine: shorten(lastLine(result.output), 500), exitCode: result.exitCode, timedOut: result.timedOut, error: result.exitCode === 0 && !result.timedOut ? null : result.stderr || result.output},
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
    "Role: " + request.role,
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

const maxCapturedSubagentCharacters = 50_000;
const maxSubagentEventCharacters = 1_000_000;
const maxCapturedSubagentMessages = 1_000;
const maxCapturedSubagentMessageCharacters = 1_000_000;

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
    let capturedMessageCharacters = 0;
    let stdout = "";
    let discardingOversizedLine = false;
    const stderr = new BoundedTextBuffer(maxCapturedSubagentCharacters);
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
        if (
          event.message
          && messages.length < maxCapturedSubagentMessages
          && capturedMessageCharacters + line.length <= maxCapturedSubagentMessageCharacters
        ) {
          messages.push(event.message);
          capturedMessageCharacters += line.length;
        }
        const directToolCall = toolCallFromEvent(event);
        if (directToolCall) {
          seenToolCalls.add(directToolCall.key);
          subagents.updateRun(node.id, {latestLine: `→ ${directToolCall.summary}`});
          emitTreeUpdate();
        }
        const toolCall = toolCallFromMessage(event.message);
        if (toolCall && !seenToolCalls.has(toolCall.key)) {
          seenToolCalls.add(toolCall.key);
          subagents.updateRun(node.id, {latestLine: `→ ${toolCall.summary}`});
          emitTreeUpdate();
        }
        const text = textFromMessage(event.message);
        if (text) {
          output = truncateText(text, maxCapturedSubagentCharacters);
          subagents.updateRun(node.id, {latestLine: shorten(lastLine(text), 500)});
          emitTreeUpdate();
        }
      } catch {
        // Ignore non-JSON output from child process.
      }
    };

    proc.stdout.on("data", (chunk) => {
      let text = chunk.toString();
      if (discardingOversizedLine) {
        const newline = text.indexOf("\n");
        if (newline < 0) return;
        text = text.slice(newline + 1);
        discardingOversizedLine = false;
      }

      const lines = `${stdout}${text}`.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length <= maxSubagentEventCharacters) processLine(line);
      }
      if (stdout.length > maxSubagentEventCharacters) {
        stdout = "";
        discardingOversizedLine = true;
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr.append(chunk.toString());
    });

    proc.on("close", (code) => {
      if (!discardingOversizedLine && stdout.trim()) processLine(stdout);
      const capturedStderr = stderr.value();
      finish({
        output: output || capturedStderr || "(no output)",
        exitCode: code ?? 0,
        timedOut,
        stderr: capturedStderr,
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

function toolCallFromEvent(event: unknown): {key: string; summary: string} | null {
  if (!event || typeof event !== "object") return null;
  const type = "type" in event ? event.type : null;
  if (type !== PiJsonEventType.toolCall && type !== PiJsonEventType.toolExecutionStart && type !== PiJsonEventType.toolExecutionUpdate) return null;
  const name = "toolName" in event && typeof event.toolName === "string" ? event.toolName : null;
  if (!name) return null;
  const rawArgs = type === PiJsonEventType.toolCall
    ? "input" in event ? event.input : null
    : "args" in event ? event.args : null;
  const args = recordValue(rawArgs);
  const id = "toolCallId" in event && typeof event.toolCallId === "string" ? event.toolCallId : `${name}:${JSON.stringify(args)}`;
  return {key: id, summary: summarizeToolCall(name, args)};
}

function toolCallFromMessage(message: unknown): {key: string; summary: string} | null {
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== AssistantMessageRole.assistant) return null;
  const content = "content" in message ? message.content : undefined;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === MessagePartType.toolCall &&
      "name" in part &&
      typeof part.name === "string"
    ) {
      const args = recordValue(toolCallArguments(part));
      const explicitId = "id" in part && typeof part.id === "string" ? part.id : undefined;
      const key = explicitId ?? `${part.name}:${JSON.stringify(args)}`;
      return {key, summary: summarizeToolCall(part.name, args)};
    }
  }
  return null;
}

function toolCallArguments(part: object): unknown {
  if ("arguments" in part) return part.arguments;
  if ("input" in part) return part.input;
  if ("args" in part) return part.args;
  return null;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function summarizeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case toolNames.read:
    case toolNames.stat:
    case toolNames.write:
    case toolNames.edit:
    case toolNames.delete:
    case toolNames.mkdir:
      return withParts(name, stringArg(args, "path"));
    case toolNames.copy:
    case toolNames.move:
      return withParts(name, arrow(stringArg(args, "from"), stringArg(args, "to")));
    case toolNames.bash:
      return withParts(name, stringArg(args, "command"));
    case toolNames.executeCode:
      return withParts(name, stringArg(args, "language"), stringArg(args, "file") ?? stringArg(args, "mode") ?? "inline");
    case toolNames.executeCodeInfo:
      return withParts(name, stringArg(args, "language"));
    case toolNames.webLookup:
      return withParts(name, stringArg(args, "query") ?? stringArg(args, "url"));
    case toolNames.localSql:
      return withParts(name, stringArg(args, "action") ?? "schema", stringArg(args, "purpose") ?? firstLine(stringArg(args, "sql")));
    case toolNames.policyInfo:
      return withParts(name, stringArg(args, "kind") ?? "overview", stringArg(args, "path") ?? stringArg(args, "command") ?? stringArg(args, "url") ?? stringArg(args, "language"));
    case toolNames.subagentSpawn:
      return withParts(name, stringArg(args, "role"), stringArg(args, "task"));
    case toolNames.subagentSpawnPersona:
      return withParts(name, stringArg(args, "persona"), stringArg(args, "task"));
    case toolNames.availablePersonas:
      return withParts(name);
    case toolNames.subagentStatus:
    case toolNames.subagentCancel:
      return withParts(name, stringArg(args, "jobId"));
    case toolNames.subagentAwait:
      return withParts(name, stringArrayArg(args, "jobIds").join(", "));
    case toolNames.subagentMessage:
      return withParts(name, stringArg(args, "jobId"), stringArg(args, "task"));
    default:
      return withParts(name, genericArgsSummary(args));
  }
}

function withParts(...parts: Array<string | null | undefined>): string {
  return shorten(parts.filter((part): part is string => Boolean(part && part.trim())).join(" "));
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (typeof value === "string" && value.trim()) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function arrow(left: string | null, right: string | null): string | null {
  if (left && right) return `${left} → ${right}`;
  return left ?? right;
}

function firstLine(value: string | null): string | null {
  if (!value) return null;
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null;
}

function genericArgsSummary(args: Record<string, unknown>): string | null {
  const entries = Object.entries(args);
  const stringEntry = entries.find(([, value]) => typeof value === "string" && value.trim().length > 0);
  if (stringEntry) return `${stringEntry[0]}=${stringEntry[1]}`;
  return entries.length > 0 ? JSON.stringify(args) : null;
}

function shorten(value: string, maxLength = 140): string {
  const bounded = value.length > maxLength * 4 ? value.slice(0, maxLength * 4) : value;
  const normalized = bounded.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength || bounded.length < value.length
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function lastLine(text: string): string {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end--;
  if (end === 0) return "";

  const newline = Math.max(text.lastIndexOf("\n", end - 1), text.lastIndexOf("\r", end - 1));
  return text.slice(newline + 1, end).trim();
}

function textFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== AssistantMessageRole.assistant) return null;
  const content = "content" in message ? message.content : undefined;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === MessagePartType.text &&
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
