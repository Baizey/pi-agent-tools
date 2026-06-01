import {PiExtensionApi} from "../../pi/types";
import {AgentServices} from "../../pi/runtime";
import {FsAccessType, PolicyStatus} from "../../policy/types";
import {stringValue} from "../../shared/values";

type PolicyInfoParams = {
  kind?: unknown;
  path?: unknown;
  accessType?: unknown;
  command?: unknown;
};

const fsAccessTypes = Object.values(FsAccessType);

export function registerPolicyInfoTool(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerTool?.({
    name: "policy_info",
    label: "Policy Info",
    description: "Show active path and shell policies, or evaluate a specific path or shell command.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["overview", "path", "shell"],
          description: "Use overview for all active policies, path to evaluate a path, or shell to evaluate a command. Defaults to overview.",
          default: "overview",
        },
        path: {
          type: "string",
          description: "Path to evaluate when kind is path.",
        },
        accessType: {
          type: "string",
          enum: fsAccessTypes,
          description: "Optional path access type to evaluate. If omitted, all access types are evaluated.",
        },
        command: {
          type: "string",
          description: "Shell command to evaluate when kind is shell.",
        },
      },
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const runtime = services.runtimeFor(ctx?.cwd ?? process.cwd());
      const input = params as PolicyInfoParams;
      const kind = stringValue(input.kind) ?? "overview";

      if (kind === "path") return pathPolicyInfo(runtime, input);
      if (kind === "shell") return shellPolicyInfo(runtime, input);
      if (kind !== "overview") return errorResult(`Unknown policy_info kind: ${kind}`);

      const overview = {
        pathPolicies: runtime.pathPolicy.policiesSnapshot(),
        shellPolicies: runtime.shellPolicy.policiesSnapshot(),
      };
      return successResult(JSON.stringify(overview, null, 2), overview);
    },
  });
}

function pathPolicyInfo(runtime: ReturnType<AgentServices["runtimeFor"]>, input: PolicyInfoParams) {
  const candidatePath = stringValue(input.path);
  if (!candidatePath) return errorResult("Missing required parameter for path policy lookup: path.");

  const requestedAccessType = stringValue(input.accessType);
  const accessTypes = requestedAccessType ? [requestedAccessType] : fsAccessTypes;
  const invalid = accessTypes.find((it) => !fsAccessTypes.includes(it as FsAccessType));
  if (invalid) return errorResult(`Invalid path accessType: ${invalid}`);

  const evaluations = accessTypes.map((accessType) => {
    const result = runtime.pathPolicy.evaluate(candidatePath, accessType as FsAccessType, true);
    if (!result) {
      return {
        evaluatedPath: candidatePath,
        evaluatedAccessType: accessType,
        matchedStatus: "UNKNOWN",
        matchedReason: "No matching path policy found.",
      };
    }
    if (result.matchedReason.startsWith("No matching policy found.")) {
      return {
        evaluatedPath: result.evaluatedPath,
        evaluatedAccessType: result.evaluatedAccessType,
        matchedStatus: "UNKNOWN",
        matchedReason: "No matching path policy found.",
      };
    }
    return result;
  });

  return successResult(JSON.stringify(evaluations, null, 2), {evaluations});
}

function shellPolicyInfo(runtime: ReturnType<AgentServices["runtimeFor"]>, input: PolicyInfoParams) {
  const command = stringValue(input.command);
  if (!command) return errorResult("Missing required parameter for shell policy lookup: command.");

  const result = runtime.shellPolicy.evaluate(command, false);
  const details = result ?? {
    command,
    status: "UNKNOWN",
    reason: "No matching shell policy found.",
    pendingPolicyScopeOptions: runtime.shellPolicy.pendingPolicyScopeOptions(command),
  };
  return successResult(JSON.stringify(details, null, 2), details);
}

function successResult(text: string, details: Record<string, unknown>) {
  return {content: [{type: "text" as const, text}], details};
}

function errorResult(message: string, details: Record<string, unknown> = {}) {
  return {
    content: [{type: "text" as const, text: message}],
    details: {...details, error: true, status: PolicyStatus.DENIED},
    isError: true,
  };
}
