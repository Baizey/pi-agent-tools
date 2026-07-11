import type {Theme} from "../../../pi/types";
import {renderBlockToolCall} from "../../../shared/blockToolRendering";
import type {ExpansionContext} from "../../../shared/rendering/types";
import {ToolName} from "../../../shared/toolNames";
import {renderToolCallInput} from "../../../shared/toolRendering";
import {stringValue} from "../../../shared/values";
import type {ExecInput} from "./types";

export function renderCodeExecCall(args: Record<string, unknown>, theme?: Theme, context?: ExpansionContext) {
  const input = args as ExecInput;
  const code = stringValue(input.code);
  if (!code) {
    return renderToolCallInput(ToolName.executeCode, args, theme, context);
  }

  return renderBlockToolCall({
    title: ToolName.executeCode,
    fields: codeExecFields(input),
    block: {label: "code", text: code},
  }, theme, context);
}

function codeExecFields(input: ExecInput) {
  const purpose = stringValue(input.purpose);
  const cwd = stringValue(input.cwd);
  return [
    {label: "language", value: stringValue(input.language) ?? "<missing>"},
    {label: "purpose", value: purpose, omit: !purpose},
    {label: "mode", value: "inline"},
    {label: "args", value: input.args, omit: !Array.isArray(input.args)},
    {label: "cwd", value: cwd, omit: !cwd},
    {label: "timeout", value: input.timeoutSeconds, omit: typeof input.timeoutSeconds !== "number"},
  ];
}
