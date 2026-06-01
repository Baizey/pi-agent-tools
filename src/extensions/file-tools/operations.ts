import fs from "node:fs/promises";
import {ExtensionContext} from "../../pi/types";
import {
  errorMessage,
  errorResult,
  exists,
  FileToolParams,
  sourceAndDestination,
  successResult,
  targetPath,
} from "./common";

export async function deletePath(params: FileToolParams, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
  const target = targetPath(params, ctx);
  if ("error" in target) return errorResult(target.error);
  if (signal?.aborted) return errorResult("Delete cancelled before it started.");

  const recursive = params.recursive === true;

  try {
    await fs.rm(target.path, {recursive, force: false});
    return successResult(`Deleted ${recursive ? "recursively " : ""}${target.path}`, {path: target.path, recursive});
  } catch (error) {
    return errorResult(`Error deleting ${target.path}: ${errorMessage(error)}`, {path: target.path, recursive});
  }
}

export async function copyPath(params: FileToolParams, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
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

export async function movePath(params: FileToolParams, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
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

export async function makeDirectory(params: FileToolParams, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
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

export async function statPath(params: FileToolParams, signal: AbortSignal | undefined, ctx?: ExtensionContext) {
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
