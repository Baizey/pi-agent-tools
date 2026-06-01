import fs from "node:fs/promises";
import path from "node:path";
import {ExtensionContext, PiExtensionApi} from "../../pi/types";
import {stringValue} from "../../shared/values";

type Params = Record<string, unknown>;

export function registerFileTools(pi: PiExtensionApi): void {
  pi.registerTool?.({
    name: "copy",
    label: "Copy",
    description: "Copy a file or directory. Set recursive to true to copy directories.",
    parameters: objectSchema({
      from: stringParam("Source path to copy from."),
      to: stringParam("Destination path to copy to."),
      recursive: booleanParam("Copy directories recursively. Defaults to false.", false),
      overwrite: booleanParam("Overwrite an existing destination. Defaults to false.", false),
    }, ["from", "to"]),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return copyPath(params, signal, ctx);
    },
  });

  pi.registerTool?.({
    name: "move",
    label: "Move",
    description: "Move or rename a file or directory.",
    parameters: objectSchema({
      from: stringParam("Source path to move from."),
      to: stringParam("Destination path to move to."),
      overwrite: booleanParam("Overwrite an existing destination. Defaults to false.", false),
    }, ["from", "to"]),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return movePath(params, signal, ctx);
    },
  });

  pi.registerTool?.({
    name: "mkdir",
    label: "Make Directory",
    description: "Create a directory.",
    parameters: objectSchema({
      path: stringParam("Directory path to create."),
      recursive: booleanParam("Create parent directories as needed. Defaults to false.", false),
    }, ["path"]),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return makeDirectory(params, signal, ctx);
    },
  });

  pi.registerTool?.({
    name: "stat",
    label: "Stat",
    description: "Get metadata for a file or directory.",
    parameters: objectSchema({
      path: stringParam("Path to inspect."),
    }, ["path"]),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return statPath(params, signal, ctx);
    },
  });

}

async function copyPath(params: Params, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
  const paths = sourceAndDestination(params, ctx);
  if ("error" in paths) return errorResult(paths.error);
  if (signal?.aborted) return errorResult("Copy cancelled before it started.");

  const recursive = params.recursive === true;
  const overwrite = params.overwrite === true;

  try {
    await fs.cp(paths.from, paths.to, {recursive, force: overwrite, errorOnExist: !overwrite});
    return successResult(`Copied ${paths.from} to ${paths.to}`, {from: paths.from, to: paths.to, recursive, overwrite});
  } catch (error) {
    return errorResult(`Error copying ${paths.from} to ${paths.to}: ${errorMessage(error)}`, {
      from: paths.from,
      to: paths.to,
      recursive,
      overwrite,
    });
  }
}

async function movePath(params: Params, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
  const paths = sourceAndDestination(params, ctx);
  if ("error" in paths) return errorResult(paths.error);
  if (signal?.aborted) return errorResult("Move cancelled before it started.");

  const overwrite = params.overwrite === true;

  try {
    if (!overwrite && await exists(paths.to)) {
      return errorResult(`Destination already exists: ${paths.to}`, {from: paths.from, to: paths.to, overwrite});
    }
    await fs.rename(paths.from, paths.to);
    return successResult(`Moved ${paths.from} to ${paths.to}`, {from: paths.from, to: paths.to, overwrite});
  } catch (error) {
    return errorResult(`Error moving ${paths.from} to ${paths.to}: ${errorMessage(error)}`, {
      from: paths.from,
      to: paths.to,
      overwrite,
    });
  }
}

async function makeDirectory(params: Params, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
  const target = targetPath(params, ctx);
  if ("error" in target) return errorResult(target.error);
  if (signal?.aborted) return errorResult("Mkdir cancelled before it started.");

  const recursive = params.recursive === true;

  try {
    await fs.mkdir(target.path, {recursive});
    return successResult(`Created directory ${target.path}`, {path: target.path, recursive});
  } catch (error) {
    return errorResult(`Error creating directory ${target.path}: ${errorMessage(error)}`, {path: target.path, recursive});
  }
}

async function statPath(params: Params, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
  const target = targetPath(params, ctx);
  if ("error" in target) return errorResult(target.error);
  if (signal?.aborted) return errorResult("Stat cancelled before it started.");

  try {
    const stats = await fs.lstat(target.path);
    const details = {
      path: target.path,
      type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : stats.isSymbolicLink() ? "symlink" : "other",
      size: stats.size,
      mode: stats.mode,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      birthtimeMs: stats.birthtimeMs,
    };
    return successResult(JSON.stringify(details, null, 2), details);
  } catch (error) {
    return errorResult(`Error stating ${target.path}: ${errorMessage(error)}`, {path: target.path});
  }
}


function sourceAndDestination(params: Params, ctx?: ExtensionContext): {from: string; to: string} | {error: string} {
  const from = stringValue(params.from);
  if (!from) return {error: "Missing required parameter: from."};
  const to = stringValue(params.to);
  if (!to) return {error: "Missing required parameter: to."};
  const cwd = ctx?.cwd ?? process.cwd();
  return {from: path.resolve(cwd, from), to: path.resolve(cwd, to)};
}

function targetPath(params: Params, ctx?: ExtensionContext): {path: string} | {error: string} {
  const inputPath = stringValue(params.path);
  if (!inputPath) return {error: "Missing required parameter: path."};
  return {path: path.resolve(ctx?.cwd ?? process.cwd(), inputPath)};
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return {type: "object", additionalProperties: false, required, properties};
}

function stringParam(description: string): Record<string, unknown> {
  return {type: "string", description};
}

function booleanParam(description: string, defaultValue: boolean): Record<string, unknown> {
  return {type: "boolean", description, default: defaultValue};
}

function successResult(text: string, details: Record<string, unknown>) {
  return {content: [{type: "text" as const, text}], details};
}

function errorResult(message: string, details: Record<string, unknown> = {}) {
  return {
    content: [{type: "text" as const, text: message}],
    details: {...details, error: true},
    isError: true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
