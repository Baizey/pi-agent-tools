import fs from "node:fs/promises";
import path from "node:path";
import {ExtensionContext, PiExtensionApi} from "../../pi/types";
import {stringValue} from "../../shared/values";

type DeleteParams = {
  path?: unknown;
  recursive?: unknown;
};

export function registerDeleteTool(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: "delete",
    label: "Delete",
    description: "Delete a file or empty directory. Set recursive to true to delete a directory and its contents.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Path to the file or directory to delete (relative or absolute).",
        },
        recursive: {
          type: "boolean",
          description: "Delete directories recursively. Defaults to false.",
          default: false,
        },
      },
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeDelete(params as DeleteParams, signal, ctx);
    },
  });
}

async function executeDelete(params: DeleteParams, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
  const inputPath = stringValue(params.path);
  if (!inputPath) {
    return errorResult("Missing required parameter: path.");
  }

  if (signal?.aborted) return errorResult("Delete cancelled before it started.");

  const recursive = params.recursive === true;
  const cwd = ctx?.cwd ?? process.cwd();
  const resolvedPath = path.resolve(cwd, inputPath);

  try {
    await fs.rm(resolvedPath, {recursive, force: false});
    return {
      content: [{type: "text" as const, text: `Deleted ${recursive ? "recursively " : ""}${resolvedPath}`}],
      details: {path: resolvedPath, recursive},
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Error deleting ${resolvedPath}: ${message}`, {path: resolvedPath, recursive});
  }
}

function errorResult(message: string, details: Record<string, unknown> = {}) {
  return {
    content: [{type: "text" as const, text: message}],
    details: {...details, error: true},
    isError: true,
  };
}
