import path from "node:path";
import fs from "node:fs/promises";
import {ExtensionContext} from "../../pi/types";
import {stringValue} from "../../shared/values";

export type FileToolParams = Record<string, unknown>;

export function sourceAndDestination(
  params: FileToolParams,
  ctx?: ExtensionContext,
): {from: string; to: string} | {error: string} {
  const from = stringValue(params.from);
  if (!from) return {error: "Missing required parameter: from."};
  const to = stringValue(params.to);
  if (!to) return {error: "Missing required parameter: to."};
  const cwd = ctx?.cwd ?? process.cwd();
  return {from: path.resolve(cwd, from), to: path.resolve(cwd, to)};
}

export function targetPath(params: FileToolParams, ctx?: ExtensionContext): {path: string} | {error: string} {
  const inputPath = stringValue(params.path);
  if (!inputPath) return {error: "Missing required parameter: path."};
  return {path: path.resolve(ctx?.cwd ?? process.cwd(), inputPath)};
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return {type: "object", additionalProperties: false, required, properties};
}

export function stringParam(description: string): Record<string, unknown> {
  return {type: "string", description};
}

export function booleanParam(description: string, defaultValue: boolean): Record<string, unknown> {
  return {type: "boolean", description, default: defaultValue};
}

export function successResult(text: string, details: Record<string, unknown>) {
  return {content: [{type: "text" as const, text}], details};
}

export function errorResult(message: string, details: Record<string, unknown> = {}) {
  return {
    content: [{type: "text" as const, text: message}],
    details: {...details, error: true},
    isError: true,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
