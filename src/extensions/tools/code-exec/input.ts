import path from "node:path";
import {ExtensionContext} from "../../../pi/types";
import {stringValue} from "../../../shared/values";
import {CodeLanguage, ExecInput, languages, ParsedExecInput} from "./types";

export function executeCodeParameters(availableLanguages: CodeLanguage[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["language"],
    properties: {
      language: {
        type: "string",
        enum: availableLanguages,
        description: availableLanguages.length > 0
          ? `Language runtime to use. Available: ${availableLanguages.join(", ")}.`
          : "No supported language runtimes were detected at extension startup.",
      },
      code: {type: "string", description: "Inline code to execute. Mutually exclusive with file."},
      file: {type: "string", description: "Path to a source/script file to execute. Mutually exclusive with code."},
      args: {type: "array", items: {type: "string"}, description: "Arguments passed to the executed program/script."},
      stdin: {type: "string", description: "Optional stdin sent to the process."},
      cwd: {type: "string", description: "Working directory. Defaults to current cwd."},
      timeoutSeconds: {type: "number", description: "Timeout for compile and run steps. Defaults to 30 seconds."},
    },
  };
}

export function parseInput(params: ExecInput, defaultCwd: string): ParsedExecInput | {error: string} {
  const language = stringValue(params.language);
  if (!language || !isLanguage(language)) return {error: `Missing or unsupported language. Supported: ${languages.join(", ")}.`};
  const code = stringValue(params.code);
  const file = stringValue(params.file);
  if (!!code === !!file) return {error: "Provide exactly one of code or file."};
  const args = Array.isArray(params.args) ? params.args.filter((it): it is string => typeof it === "string") : [];
  const cwd = path.resolve(stringValue(params.cwd) ?? defaultCwd);
  const timeoutSeconds = typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds) && params.timeoutSeconds > 0
    ? Math.min(params.timeoutSeconds, 600)
    : 30;
  return {language, mode: code ? "inline" : "file", source: code ?? file ?? "", args, stdin: stringValue(params.stdin) ?? undefined, cwd, timeoutSeconds};
}

export function isLanguage(value: string): value is CodeLanguage {
  return (languages as readonly string[]).includes(value);
}

export function contextForCwd(ctx: ExtensionContext | undefined, cwd: string): ExtensionContext {
  return ctx ? {...ctx, cwd} : {cwd, hasUI: false};
}