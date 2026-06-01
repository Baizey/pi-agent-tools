import path from "node:path";
import {PiExtensionApi, ExtensionContext} from "../../pi/types";
import {PiDevRuntime, PiDevServices} from "../../pi/runtime";
import {PathPolicyLogic} from "../../policy/path/PathPolicyLogic";
import {FsAccessType, PathPolicyResult, PolicyLifetime, PolicyStatus} from "../../policy/types";
import {standardizePath} from "../../shared/paths";
import {stringValues} from "../../shared/values";

export function registerPathPolicy(pi: PiExtensionApi, services: PiDevServices): void {
  pi.on("tool_call", async (event, ctx) => {
    const accessType = accessTypeForTool(event.toolName);
    if (!accessType || event.toolName === "bash") return;

    const runtime = services.runtimeFor(ctx.cwd);
    for (const candidatePath of pathsForToolCall(event.toolName, event.input)) {
      const reason = await ensurePathAllowed(ctx, runtime, candidatePath, accessType, false);
      if (reason) return {block: true, reason};
    }
  });
}

async function ensurePathAllowed(
  ctx: ExtensionContext,
  runtime: PiDevRuntime,
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
  runtime: PiDevRuntime,
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

function accessTypeForTool(toolName: string): FsAccessType | null {
  switch (toolName) {
    case "read":
    case "grep":
    case "find":
    case "ls":
      return FsAccessType.READ;
    case "write":
      return FsAccessType.WRITE;
    case "edit":
      return FsAccessType.EDIT;
    case "delete":
      return FsAccessType.DELETE;
    case "bash":
      return FsAccessType.EXECUTE;
    default:
      return null;
  }
}

function pathsForToolCall(toolName: string, input: Record<string, unknown>): string[] {
  switch (toolName) {
    case "read":
    case "write":
    case "ls":
    case "edit":
    case "delete":
      return stringValues(input.path);

    case "grep":
    case "find":
      return stringValues(input.path ?? input.directory ?? input.cwd ?? ".");

    default:
      return [];
  }
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
