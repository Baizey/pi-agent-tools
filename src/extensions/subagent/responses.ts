import {errorResult, successResult} from "../../shared/toolResults";
import {SubagentRequest, SubagentResult} from "./runner";

export {errorResult, successResult};

export function subagentResultResponse(
  request: SubagentRequest,
  result: SubagentResult,
  extraDetails: Record<string, unknown> = {},
) {
  const isError = result.exitCode !== 0 || result.timedOut;
  const output = result.timedOut ? `Subagent timed out.\n${result.output}` : result.output;
  const treeText = result.tree && result.tree.length > 0 ? result.tree.join("\n") : "";
  return {
    content: [{type: "text" as const, text: treeText ? `${treeText}\n\n${output}` : output}],
    details: {
      ...extraDetails,
      mode: result.mode,
      task: request.task,
      role: request.role,
      persona: request.persona,
      cwd: request.cwd,
      timeoutSeconds: request.timeoutSeconds,
      toolkits: result.toolkits.toolkits,
      tools: result.toolkits.tools,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stderr: result.stderr,
      messages: result.messages,
      tree: result.tree,
    },
    isError,
  };
}

