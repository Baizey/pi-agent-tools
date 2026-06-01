import path from "node:path";
import {PiExtensionApi, ExtensionContext} from "../../pi/types";
import {AgentRuntime, AgentServices} from "../../pi/runtime";
import {PathPolicyLogic} from "../../policy/path/PathPolicyLogic";
import {FsAccessType, PathPolicyResult, PolicyLifetime, PolicyStatus} from "../../policy/types";
import {agentEnv, isAgentEnvEnabled} from "../../shared/env";
import {standardizePath} from "../../shared/paths";
import {stringValues} from "../../shared/values";

export function registerPathPolicy(pi: PiExtensionApi, services: AgentServices): void {
  pi.on("tool_call", async (event, ctx) => {
    const pathAccesses = pathAccessesForToolCall(event.toolName, event.input);
    if (pathAccesses.length === 0) return;

    const runtime = services.runtimeFor(ctx.cwd);
    for (const pathAccess of pathAccesses) {
      const reason = await ensurePathAllowed(
        ctx,
        runtime,
        pathAccess.path,
        pathAccess.accessType,
        isAgentEnvEnabled(agentEnv.pathDenyByDefault),
      );
      if (reason) return {block: true, reason};
    }
  });
}

async function ensurePathAllowed(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  candidatePath: string,
  accessType: FsAccessType,
  denyByDefault: boolean,
): Promise<string | null> {
  let result = runtime.pathPolicy.evaluate(candidatePath, accessType, denyByDefault);
  if (result === null) {
    result = await askForPolicy(ctx, runtime, standardizePath(ctx.cwd, candidatePath), accessType);
  }

  if (result.matchedStatus === PolicyStatus.ALLOWED) return null;
  return runtime.pathPolicy.toDenyReasonOrNull(result) ?? "Access denied.";
}

async function askForPolicy(
  ctx: ExtensionContext,
  runtime: AgentRuntime,
  evaluatedPath: string,
  accessType: FsAccessType,
): Promise<PathPolicyResult> {
  const failed = (reason: string): PathPolicyResult => ({
    evaluatedPath,
    evaluatedAccessType: accessType,
    matchedPattern: "(none)",
    matchedLifetime: PolicyLifetime.ONCE,
    matchedStatus: PolicyStatus.DENIED,
    matchedReason: reason,
  });

  if (!ctx.ui || ctx.hasUI === false) {
    return failed(`No policy matched '${evaluatedPath}' and interactive approval is unavailable.`);
  }

  const statusChoice = await ctx.ui.select(`No ${accessType} policy for ${evaluatedPath}`, ["Allow", "Deny"]);
  if (!statusChoice) return failed("Access denied: no policy decision selected.");

  const lifetimeChoice = await ctx.ui.select("Policy lifetime", [
    PolicyLifetime.ONCE,
    PolicyLifetime.SESSION,
    PolicyLifetime.FOREVER,
  ]);
  if (!lifetimeChoice) return failed("Access denied: no policy lifetime selected.");

  const scope = await ctx.ui.select("Policy scope", pathScopes(evaluatedPath, ctx.cwd));
  if (!scope) return failed("Access denied: no policy scope selected.");

  const status = statusChoice === "Allow" ? PolicyStatus.ALLOWED : PolicyStatus.DENIED;
  const lifetime = lifetimeChoice as PolicyLifetime;
  const reason = `User selected ${status} for ${accessType}.`;

  if (lifetime !== PolicyLifetime.ONCE) {
    runtime.pathPolicy.addPolicies([
      {
        path: scope,
        info: {
          [accessType]: PathPolicyLogic.createStatus(accessType, lifetime, status, reason),
        },
      },
    ]);

    if (lifetime === PolicyLifetime.FOREVER) {
      runtime.pathPolicyStore.save(runtime.pathPolicy);
    }
  }

  return {
    evaluatedPath,
    evaluatedAccessType: accessType,
    matchedPattern: scope,
    matchedLifetime: lifetime,
    matchedStatus: status,
    matchedReason: reason,
  };
}

type PathAccess = {
  path: string;
  accessType: FsAccessType;
};

function pathAccessesForToolCall(toolName: string, input: Record<string, unknown>): PathAccess[] {
  switch (toolName) {
    case "read":
    case "ls":
    case "stat":
      return accesses(input.path, FsAccessType.READ);

    case "grep":
    case "find":
      return accesses(input.path ?? input.directory ?? input.cwd ?? ".", FsAccessType.READ);

    case "write":
    case "mkdir":
      return accesses(input.path, FsAccessType.WRITE);

    case "edit":
      return accesses(input.path, FsAccessType.EDIT);

    case "delete":
      return accesses(input.path, FsAccessType.DELETE);

    case "copy":
      return [
        ...accesses(input.from, FsAccessType.READ),
        ...accesses(input.to, FsAccessType.WRITE),
      ];

    case "move":
      return [
        ...accesses(input.from, FsAccessType.DELETE),
        ...accesses(input.to, FsAccessType.WRITE),
        ...(input.overwrite === true ? accesses(input.to, FsAccessType.DELETE) : []),
      ];

    default:
      return [];
  }
}

function accesses(value: unknown, accessType: FsAccessType): PathAccess[] {
  return stringValues(value).map((path) => ({path, accessType}));
}

function pathScopes(evaluatedPath: string, cwd: string): string[] {
  const scopes: string[] = [];
  let current = evaluatedPath;
  const root = path.parse(current).root;
  const standardizedCwd = standardizePath(cwd, ".");

  while (true) {
    scopes.push(current);
    if (current === standardizedCwd || current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return scopes;
}
