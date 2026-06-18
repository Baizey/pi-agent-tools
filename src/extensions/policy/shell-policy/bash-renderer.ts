import {ExtensionContext, PiExtensionApi} from "../../../pi/types";
import {toolNames} from "../../../shared/toolNames";
import {renderToolCallInput} from "../../../shared/toolRendering";
import {renderBlockToolCall} from "../../../shared/blockToolRendering";
import {stringValue} from "../../../shared/values";

type BashToolLike = {
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: ExtensionContext,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: Record<string, unknown>;
    isError?: boolean
  }>;
};

export function registerBashSummaryRenderer(pi: PiExtensionApi): void {
  let originalBash: BashToolLike | null = null;
  try {
    const piPackage = require("@earendil-works/pi-coding-agent") as {
      createBashTool?: (cwd: string) => BashToolLike
    };
    originalBash = piPackage.createBashTool?.(process.cwd()) ?? null;
  } catch {
    return;
  }
  if (!originalBash || !pi.registerTool) return;

  pi.registerTool({
    name: toolNames.bash,
    label: "bash",
    description: originalBash.description,
    parameters: addPurposeParameter(originalBash.parameters, "Briefly describe what this bash command is intended to achieve."),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const {purpose: _purpose, ...bashParams} = params;
      return await originalBash.execute(toolCallId, bashParams, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const command = stringValue(args.command);
      if (!command) return renderToolCallInput(toolNames.bash, args, theme as never);
      return renderBlockToolCall(
        toolNames.bash,
        [
          stringValue(args.purpose) ? `  purpose: ${stringValue(args.purpose)}` : null,
          typeof args.timeout === "number" ? `  timeout: ${args.timeout}` : null,
        ],
        "command",
        command,
        context as {expanded?: boolean} | undefined,
      );
    },
  });
}

function addPurposeParameter(parameters: Record<string, unknown>, description: string): Record<string, unknown> {
  const properties = parameters.properties && typeof parameters.properties === "object" && !Array.isArray(parameters.properties)
    ? parameters.properties as Record<string, unknown>
    : {};
  return {
    ...parameters,
    properties: {
      ...properties,
      purpose: {type: "string", description},
    },
  };
}
