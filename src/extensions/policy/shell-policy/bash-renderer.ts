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
    parameters: originalBash.parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return await originalBash.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const command = stringValue(args.command);
      if (!command) return renderToolCallInput(toolNames.bash, args, theme as never);
      return renderBlockToolCall(
        toolNames.bash,
        [
          typeof args.timeout === "number" ? `  timeout: ${args.timeout}` : null,
        ],
        "command",
        command,
        context as {expanded?: boolean} | undefined,
      );
    },
  });
}
