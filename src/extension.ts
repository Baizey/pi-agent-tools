import os from "node:os";
import path from "node:path";
import { PiPathPolicy } from "./policy/PiPathPolicy";
import { PathPolicyLogic } from "./policy/path/PathPolicyLogic";
import { PathPolicyLogicStore } from "./policy/path/PathPolicyLogicStore";

export type PiExtensionApi = {
  on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallDecision | void> | ToolCallDecision | void): void;
};

type ToolCallEvent = {
  toolName: string;
  input: Record<string, unknown>;
};

type ToolCallDecision = {
  block: true;
  reason: string;
};

type ExtensionContext = {
  cwd: string;
};

type PolicyRuntime = {
  policy: PathPolicyLogic;
};

export default function gantryPolicyExtension(pi: PiExtensionApi): void {
  const runtimes = new Map<string, PolicyRuntime>();

  pi.on("tool_call", (event, ctx) => {
    const accessType = PiPathPolicy.accessTypeForTool(event.toolName);
    if (!accessType) return;

    const policy = runtimeFor(ctx.cwd, runtimes).policy;
    for (const candidatePath of pathsForToolCall(event.toolName, event.input)) {
      const result = policy.evaluate(candidatePath, accessType, true);
      const reason = policy.toDenyReasonOrNull(result);
      if (reason) return { block: true, reason };
    }
  });
}

function runtimeFor(cwd: string, runtimes: Map<string, PolicyRuntime>): PolicyRuntime {
  const key = path.resolve(cwd);
  const existing = runtimes.get(key);
  if (existing) return existing;

  const projectPiDir = path.join(key, ".pi");
  const policy = PiPathPolicy.create({
    cwd: key,
    projectPiDir,
    globalPiDir: path.join(os.homedir(), ".pi", "agent"),
  });

  new PathPolicyLogicStore(path.join(projectPiDir, "path-policy.json")).loadInto(policy);

  const runtime = { policy };
  runtimes.set(key, runtime);
  return runtime;
}

function pathsForToolCall(toolName: string, input: Record<string, unknown>): string[] {
  switch (toolName) {
    case "read":
    case "write":
    case "ls":
      return stringValues(input.path);

    case "edit":
      return stringValues(input.path);

    case "grep":
    case "find":
      return stringValues(input.path ?? input.directory ?? input.cwd ?? ".");

    default:
      return [];
  }
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  return [];
}
