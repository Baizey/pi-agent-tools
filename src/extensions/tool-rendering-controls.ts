import {ExtensionContext, PiExtensionApi} from "../pi/types";
import {ToolRenderTerminalInput} from "../shared/toolRendering";

let unsubscribeToolExpandInput: (() => void) | undefined;

export function registerToolRenderingControls(pi: PiExtensionApi): void {
  pi.on("session_start", (_event, ctx) => {
    unsubscribeToolExpandInput?.();
    unsubscribeToolExpandInput = registerToolExpandInput(ctx);
  });

  pi.on("session_shutdown", () => {
    unsubscribeToolExpandInput?.();
    unsubscribeToolExpandInput = undefined;
  });
}

export function handleToolExpandInput(
  data: string,
  ctx: Pick<ExtensionContext, "ui">,
): {consume?: boolean; data?: string} | undefined {
  if (data !== ToolRenderTerminalInput.TOOLS_EXPAND) return undefined;
  const getToolsExpanded = ctx.ui?.getToolsExpanded;
  const setToolsExpanded = ctx.ui?.setToolsExpanded;
  if (!getToolsExpanded || !setToolsExpanded) return undefined;

  setToolsExpanded(!getToolsExpanded());
  return {consume: true};
}

function registerToolExpandInput(ctx: ExtensionContext): (() => void) | undefined {
  if (!ctx.ui?.onTerminalInput || !ctx.ui.getToolsExpanded || !ctx.ui.setToolsExpanded) return undefined;
  return ctx.ui.onTerminalInput((data) => handleToolExpandInput(data, ctx));
}
