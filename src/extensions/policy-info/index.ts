import {PiExtensionApi} from "../../pi/types";
import {AgentServices} from "../../pi/runtime";
import {FsAccessType, PolicyStatus, WebAccessType} from "../../policy/types";
import {toolNames} from "../../shared/toolNames";
import {renderToolCallInput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";

export enum PolicyInfoKind {
  OVERVIEW = "overview",
  PATH = "path",
  SHELL = "shell",
  CODE = "code",
  WEB = "web",
}

type PolicyInfoParams = {
  kind?: unknown;
  path?: unknown;
  accessType?: unknown;
  command?: unknown;
  language?: unknown;
  mode?: unknown;
  url?: unknown;
};

const fsAccessTypes = Object.values(FsAccessType);
const webAccessTypes = Object.values(WebAccessType);
const policyInfoKinds = Object.values(PolicyInfoKind);

export function registerPolicyInfoTool(pi: PiExtensionApi, services: AgentServices): void {
  pi.registerTool?.({
    name: toolNames.policyInfo,
    label: "Policy Info",
    description: "Show active path, shell, code, and web policies, or evaluate a specific policy target.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: policyInfoKinds,
          description: "Use overview for all active policies, path to evaluate a path, shell to evaluate a command, code to evaluate code execution, or web to evaluate a URL. Defaults to overview.",
          default: PolicyInfoKind.OVERVIEW,
        },
        path: {
          type: "string",
          description: "Path to evaluate when kind is path.",
        },
        accessType: {
          type: "string",
          enum: [...fsAccessTypes, ...webAccessTypes],
          description: "Optional access type to evaluate. For path use file access types; for web use READ or SEARCH. If omitted, all relevant access types are evaluated.",
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
        url: {
          type: "string",
          description: "Full URL to evaluate when kind is web.",
        },
      },
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const runtime = services.runtimeFor(ctx?.cwd ?? process.cwd());
      const input = params as PolicyInfoParams;
      const kind = parsePolicyInfoKind(input.kind);
      if (!kind) return errorResult(`Unknown policy_info kind: ${String(input.kind)}`);

      if (kind === PolicyInfoKind.PATH) return pathPolicyInfo(runtime, input);
      if (kind === PolicyInfoKind.SHELL) return shellPolicyInfo(runtime, input);
      if (kind === PolicyInfoKind.CODE) return codePolicyInfo(runtime, input);
      if (kind === PolicyInfoKind.WEB) return webPolicyInfo(runtime, input);

      const overview = {
        pathPolicies: runtime.pathPolicy.policiesSnapshot(),
        shellPolicies: runtime.shellPolicy.policiesSnapshot(),
        codeExecPolicies: runtime.codeExecPolicy.policiesSnapshot(),
        webPolicies: runtime.webPolicy.policiesSnapshot(),
      };
      return successResult(JSON.stringify(overview, null, 2), overview);
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.policyInfo, args, theme as never);
    },
  });
}

function parsePolicyInfoKind(value: unknown): PolicyInfoKind | null {
  if (value === undefined || value === null) return PolicyInfoKind.OVERVIEW;
  const candidate = stringValue(value);
  return candidate && policyInfoKinds.includes(candidate as PolicyInfoKind) ? candidate as PolicyInfoKind : null;
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

function webPolicyInfo(runtime: ReturnType<AgentServices["runtimeFor"]>, input: PolicyInfoParams) {
  const url = stringValue(input.url);
  if (!url) return errorResult("Missing required parameter for web policy lookup: url.");

  const requestedAccessType = stringValue(input.accessType);
  const accessTypes = requestedAccessType ? [requestedAccessType] : webAccessTypes;
  const invalid = accessTypes.find((it) => !webAccessTypes.includes(it as WebAccessType));
  if (invalid) return errorResult(`Invalid web accessType: ${invalid}`);

  const evaluations = accessTypes.map((accessType) => {
    const result = runtime.webPolicy.evaluate(url, accessType as WebAccessType, false);
    return result ?? {
      url,
      accessType,
      status: "UNKNOWN",
      reason: "No matching web policy found.",
      pendingPolicyScopeOptions: runtime.webPolicy.pendingPolicyScopeOptions(url, accessType as WebAccessType),
    };
  });

  return successResult(JSON.stringify(evaluations, null, 2), {evaluations});
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
