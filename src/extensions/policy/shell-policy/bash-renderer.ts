import type {ExtensionContext, PiExtensionApi, Theme} from "../../../pi/types";
import {renderBlockToolCall} from "../../../shared/blockToolRendering";
import {toolNames} from "../../../shared/toolNames";
import {renderToolCallInput} from "../../../shared/toolRendering";
import {stringValue} from "../../../shared/values";
import type {ExpansionContext} from "../../../shared/rendering/types";

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
    content: Array<{type: "text"; text: string}>;
    details?: Record<string, unknown>;
    isError?: boolean;
  }>;
};

const purposeDescription = "Briefly describe what this bash command is intended to achieve.";

export function registerBashSummaryRenderer(pi: PiExtensionApi): void {
  const bash = loadBashTool();
  if (!bash || !pi.registerTool) return;

  const nativePurpose = hasPurposeParameter(bash.parameters);
  pi.registerTool({
    name: toolNames.bash,
    label: "bash",
    description: bash.description,
    parameters: nativePurpose ? bash.parameters : withPurposeParameter(bash.parameters),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (nativePurpose) return bash.execute(toolCallId, params, signal, onUpdate, ctx);
      const {purpose: _purpose, ...bashParams} = params;
      return bash.execute(toolCallId, bashParams, signal, onUpdate, ctx);
    },
    renderCall: renderBashCall,
    // renderResult is intentionally omitted. Pi inherits the built-in bash
    // result renderer independently from this call renderer.
  });
}

export function renderBashCall(args: Record<string, unknown>, theme?: Theme, context?: ExpansionContext) {
  const command = stringValue(args.command);
  if (!command) {
    return renderToolCallInput(toolNames.bash, args, theme, context);
  }

  const purpose = stringValue(args.purpose);
  return renderBlockToolCall({
    title: toolNames.bash,
    fields: [
      {label: "purpose", value: purpose, omit: !purpose},
      {label: "timeout", value: args.timeout, omit: typeof args.timeout !== "number"},
    ],
    block: {label: "command", text: command},
  }, theme, context);
}

function loadBashTool(): BashToolLike | undefined {
  try {
    const piPackage = require("@earendil-works/pi-coding-agent") as {
      createBashTool?: (cwd: string) => BashToolLike;
    };
    return piPackage.createBashTool?.(process.cwd());
  } catch {
    return undefined;
  }
}

function hasPurposeParameter(parameters: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(objectValue(parameters.properties), "purpose");
}

function withPurposeParameter(parameters: Record<string, unknown>): Record<string, unknown> {
  const properties = objectValue(parameters.properties);
  return {
    ...parameters,
    properties: {
      ...properties,
      purpose: {type: "string", description: purposeDescription},
    },
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
