import {PiExtensionApi} from "../../pi/types";
import {AgentServices} from "../../pi/runtime";
import {FsAccessType, PolicyStatus} from "../../policy/types";
import {toolNames} from "../../shared/toolNames";
import {renderToolCallInput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";

type PolicyInfoParams = {
  kind?: unknown;
  path?: unknown;
  accessType?: unknown;
  command?: unknown;
  language?: unknown;
  mode?: unknown;
};

const fsAccessTypes = Object.values(FsAccessType);

export function registerPolicyInfoTool(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerTool?.({
    name: toolNames.policyInfo,
    label: "Policy Info",
    description: "Show active path and shell policies, or evaluate a specific path or shell command.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["overview", "path", "shell", "code"],
          description: "Use overview for all active policies, path to evaluate a path, shell to evaluate a command, or code to evaluate code execution. Defaults to overview.",
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
        language: {
          type: "string",
          description: "Code language to evaluate when kind is code.",
        },
        mode: {
          type: "string",
          enum: ["inline", "file"],
          description: "Code execution mode to evaluate when kind is code.",
        },
      },
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const runtime = services.runtimeFor(ctx?.cwd ?? process.cwd());
      const input = params as PolicyInfoParams;
      const kind = stringValue(input.kind) ?? "overview";

      if (kind === "path") return pathPolicyInfo(runtime, input);
      if (kind === "shell") return shellPolicyInfo(runtime, input);
      if (kind === "code") return codePolicyInfo(runtime, input);
      if (kind !== "overview") return errorResult(`Unknown policy_info kind: ${kind}`);

      const overview = {
        pathPolicies: runtime.pathPolicy.policiesSnapshot(),
        shellPolicies: runtime.shellPolicy.policiesSnapshot(),
        codeExecPolicies: runtime.codeExecPolicy.policiesSnapshot(),
      };
      return successResult(JSON.stringify(overview, null, 2), overview);
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.policyInfo, args, theme as never);
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

function codePolicyInfo(runtime: ReturnType<AgentServices["runtimeFor"]>, input: PolicyInfoParams) {
  const language = stringValue(input.language);
  const mode = stringValue(input.mode);
  if (!language) return errorResult("Missing required parameter for code policy lookup: language.");
  if (mode !== "inline" && mode !== "file") return errorResult("Missing or invalid required parameter for code policy lookup: mode.");

  const result = runtime.codeExecPolicy.evaluate(language, mode, false);
  const details = result ?? {
    language,
    mode,
    status: "UNKNOWN",
    reason: "No matching code execution policy found.",
    pendingPolicyScopeOptions: runtime.codeExecPolicy.pendingPolicyScopeOptions(language, mode),
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
