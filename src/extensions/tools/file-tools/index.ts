import {PiExtensionApi} from "../../../pi/types";
import {ToolName} from "../../../shared/toolNames";
import {FoldDirection, renderToolCallInput, renderToolResultOutput} from "../../../shared/toolRendering";
import {booleanParam, objectSchema, stringParam} from "./common";
import {copyPath, deletePath, makeDirectory, movePath, statPath} from "./operations";

type FileToolRegistration = {
  name: ToolName;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: typeof deletePath;
};

export function registerFileTools(pi: PiExtensionApi): void {
  for (const tool of fileTools()) registerFileTool(pi, tool);
}

function registerFileTool(pi: PiExtensionApi, tool: FileToolRegistration): void {
  pi.registerTool?.({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return tool.execute(params, signal, ctx);
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(tool.name, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD});
    },
  });
}

function fileTools(): FileToolRegistration[] {
  return [
    {
      name: ToolName.delete,
      label: "Delete",
      description: "Delete a file or empty directory. Set recursive to true to delete a directory and its contents.",
      parameters: objectSchema({
        path: stringParam("Path to the file or directory to delete."),
        recursive: booleanParam("Delete directories recursively. Defaults to false.", false),
      }, ["path"]),
      execute: deletePath,
    },
    {
      name: ToolName.copy,
      label: "Copy",
      description: "Copy a file or directory. Set recursive to true to copy directories.",
      parameters: objectSchema({
        from: stringParam("Source path to copy from."),
        to: stringParam("Destination path to copy to."),
        recursive: booleanParam("Copy directories recursively. Defaults to false.", false),
        overwrite: booleanParam("Overwrite an existing destination. Defaults to false.", false),
      }, ["from", "to"]),
      execute: copyPath,
    },
    {
      name: ToolName.move,
      label: "Move",
      description: "Move or rename a file or directory.",
      parameters: objectSchema({
        from: stringParam("Source path to move from."),
        to: stringParam("Destination path to move to."),
        overwrite: booleanParam("Overwrite an existing destination. Defaults to false.", false),
      }, ["from", "to"]),
      execute: movePath,
    },
    {
      name: ToolName.mkdir,
      label: "Make Directory",
      description: "Create a directory.",
      parameters: objectSchema({
        path: stringParam("Directory path to create."),
        recursive: booleanParam("Create parent directories as needed. Defaults to false.", false),
      }, ["path"]),
      execute: makeDirectory,
    },
    {
      name: ToolName.stat,
      label: "Stat",
      description: "Get metadata for a file or directory.",
      parameters: objectSchema({
        path: stringParam("Path to inspect."),
      }, ["path"]),
      execute: statPath,
    },
  ];
}

