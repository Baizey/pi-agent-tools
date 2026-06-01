import {SubagentRequest, SubagentResult} from "./runner";

export function subagentResultResponse(
  request: SubagentRequest,
  result: SubagentResult,
  extraDetails: Record<string, unknown> = {},
) {
  const isError = result.exitCode !== 0 || result.timedOut;
  return {
    content: [{type: "text" as const, text: result.timedOut ? `Subagent timed out.\n${result.output}` : result.output}],
    details: {
      ...extraDetails,
      mode: result.mode,
      task: request.task,
      cwd: request.cwd,
      timeoutSeconds: request.timeoutSeconds,
      profiles: result.profiles.profiles,
      tools: result.profiles.tools,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stderr: result.stderr,
      messages: result.messages,
    },
    isError,
  };
}

export function successResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{type: "text" as const, text}],
    details,
  };
}

export function errorResult(message: string, details: Record<string, unknown> = {}) {
  return {
    content: [{type: "text" as const, text: message}],
    details: {...details, error: true},
    isError: true,
  };
}
