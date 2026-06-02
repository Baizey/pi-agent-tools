import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {ExtensionContext, PiExtensionApi} from "../../pi/types";
import {AgentServices} from "../../pi/runtime";
import {FsAccessType} from "../../policy/types";
import {toolNames} from "../../shared/toolNames";
import {renderToolCallInput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";
import {ensurePathAllowed} from "../path-policy";

const languages = [
  "javascript",
  "typescript",
  "python",
  "powershell",
  "ruby",
  "php",
  "perl",
  "go",
  "java",
  "dotnet",
  "c",
  "cpp",
  "rust",
] as const;

type CodeLanguage = typeof languages[number];
type ExecutionMode = "inline" | "file";

type ExecInput = {
  language?: unknown;
  code?: unknown;
  file?: unknown;
  args?: unknown;
  stdin?: unknown;
  cwd?: unknown;
  timeoutSeconds?: unknown;
};

type RuntimeInfo = {
  language: CodeLanguage;
  available: boolean;
  executable?: string;
  version?: string;
  error?: string;
  modes: ExecutionMode[];
  notes?: string[];
};

type ExecPlan = {
  command: string;
  args: string[];
  cwd: string;
  cleanup?: () => Promise<void>;
  compile?: {command: string; args: string[]; cwd: string};
  info: RuntimeInfo;
};

type Adapter = {
  language: CodeLanguage;
  modes: ExecutionMode[];
  detect(): Promise<RuntimeInfo>;
  plan(input: {mode: ExecutionMode; source: string; args: string[]; cwd: string}): Promise<ExecPlan>;
};

const detectionCache = new Map<CodeLanguage, Promise<RuntimeInfo>>();

export async function registerCodeExecutionTool(pi: PiExtensionApi, services: AgentServices): Promise<void> {
  const runtimeInfo = await detectAllRuntimes();
  const availableLanguages = runtimeInfo.filter((result) => result.available).map((result) => result.language);

  pi.registerTool?.({
    name: toolNames.executeCode,
    label: "Execute Code",
    description: "Execute code from an inline snippet or file using a detected language runtime. Uses direct process spawning, not a shell.",
    parameters: executeCodeParameters(availableLanguages),
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as ExecInput;
      const parsed = parseInput(params, ctx?.cwd ?? process.cwd());
      if ("error" in parsed) return errorResult(parsed.error);

      const runtime = services.runtimeFor(parsed.cwd);
      if (parsed.mode === "file") {
        const readReason = await ensurePathAllowed(ctx ?? minimalContext(parsed.cwd), runtime, parsed.source, FsAccessType.READ, false);
        if (readReason) return errorResult(readReason, {blocked: true});
        const executeReason = await ensurePathAllowed(ctx ?? minimalContext(parsed.cwd), runtime, parsed.source, FsAccessType.EXECUTE, false);
        if (executeReason) return errorResult(executeReason, {blocked: true});
      }

      const adapter = adapters[parsed.language];
      const info = await detect(adapter);
      if (!info.available) return errorResult(`Runtime unavailable for ${parsed.language}: ${info.error ?? "not found"}`, {runtime: info});
      if (!info.modes.includes(parsed.mode)) return errorResult(`${parsed.language} does not support ${parsed.mode} execution.`, {runtime: info});

      let plan: ExecPlan | undefined;
      try {
        plan = await adapter.plan(parsed);
        const compile = plan.compile ? await runProcess(plan.compile, parsed.stdin, parsed.timeoutSeconds, signal) : undefined;
        if (compile && compile.exitCode !== 0) {
          return successResult("Compilation failed.", {runtime: plan.info, compile, run: null}, true);
        }
        const run = await runProcess(plan, parsed.stdin, parsed.timeoutSeconds, signal);
        return successResult(formatRunSummary(run), {runtime: plan.info, compile: compile ?? null, run}, run.exitCode !== 0 || run.timedOut);
      } finally {
        await plan?.cleanup?.().catch(() => undefined);
      }
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.executeCode, args, theme as never);
    },
  });

  pi.registerTool?.({
    name: toolNames.executeCodeInfo,
    label: "Code Runtimes",
    description: "Show detected code execution runtimes, versions, supported modes, and detection errors.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        language: {type: "string", enum: languages, description: "Optional language to inspect."},
      },
    },
    async execute(_toolCallId, rawParams) {
      const rawLanguage = stringValue((rawParams as {language?: unknown}).language);
      if (rawLanguage && !isLanguage(rawLanguage)) return errorResult(`Unsupported language: ${rawLanguage}`);
      const language = rawLanguage as CodeLanguage | null;
      const results = language ? [await detect(adapters[language])] : await detectAllRuntimes();
      return successResult(formatRuntimeInfo(results), {runtimes: results});
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.executeCodeInfo, args, theme as never);
    },
  });
}

async function detectAllRuntimes(): Promise<RuntimeInfo[]> {
  return Promise.all(languages.map(async (language) => detect(adapters[language])));
}

function executeCodeParameters(availableLanguages: CodeLanguage[]): Record<string, unknown> {
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

function parseInput(params: ExecInput, defaultCwd: string): {language: CodeLanguage; mode: ExecutionMode; source: string; args: string[]; stdin?: string; cwd: string; timeoutSeconds: number} | {error: string} {
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

function isLanguage(value: string): value is CodeLanguage {
  return (languages as readonly string[]).includes(value);
}

async function detect(adapter: Adapter): Promise<RuntimeInfo> {
  let promise = detectionCache.get(adapter.language);
  if (!promise) {
    promise = adapter.detect();
    detectionCache.set(adapter.language, promise);
  }
  return promise;
}

const adapters: Record<CodeLanguage, Adapter> = {
  javascript: interpreted("javascript", ["node"], ["--version"], (exe, source, mode, args) => mode === "inline" ? [exe, ["-e", source, ...args]] : [exe, [source, ...args]]),
  typescript: tempFileAdapter("typescript", ["tsx", "ts-node"], ["--version"], ".ts", (exe, file, args) => [exe, [file, ...args]]),
  python: interpreted("python", process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"], ["--version"], (exe, source, mode, args) => mode === "inline" ? [exe, ["-c", source, ...args]] : [exe, [source, ...args]]),
  powershell: interpreted("powershell", process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"], ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], (exe, source, mode, args) => mode === "inline" ? [exe, ["-NoProfile", "-Command", source, ...args]] : [exe, ["-NoProfile", "-File", source, ...args]]),
  ruby: interpreted("ruby", ["ruby"], ["--version"], (exe, source, mode, args) => mode === "inline" ? [exe, ["-e", source, ...args]] : [exe, [source, ...args]]),
  php: interpreted("php", ["php"], ["--version"], (exe, source, mode, args) => mode === "inline" ? [exe, ["-r", source, ...args]] : [exe, [source, ...args]]),
  perl: interpreted("perl", ["perl"], ["--version"], (exe, source, mode, args) => mode === "inline" ? [exe, ["-e", source, ...args]] : [exe, [source, ...args]]),
  go: tempFileAdapter("go", ["go"], ["version"], ".go", (exe, file, args) => [exe, ["run", file, ...args]]),
  java: tempFileAdapter("java", ["java"], ["-version"], ".java", (exe, file, args) => [exe, [file, ...args]], ["Uses Java source-file execution; requires Java 11+."], "Main.java"),
  dotnet: tempFileAdapter("dotnet", ["dotnet-script", "csi"], ["--version"], ".csx", (exe, file, args) => exe === "csi" ? [exe, [file, ...args]] : [exe, [file, "--", ...args]], ["Requires dotnet-script or csi for script execution."]),
  c: compiledAdapter("c", [["gcc", ["--version"]], ["clang", ["--version"]]], ".c", (exe, src, out) => [exe, [src, "-o", out]]),
  cpp: compiledAdapter("cpp", [["g++", ["--version"]], ["clang++", ["--version"]]], ".cpp", (exe, src, out) => [exe, [src, "-o", out]]),
  rust: compiledAdapter("rust", [["rustc", ["--version"]],], ".rs", (exe, src, out) => [exe, [src, "-o", out]]),
};

function interpreted(
  language: CodeLanguage,
  executables: string[],
  versionArgs: string[],
  build: (exe: string, source: string, mode: ExecutionMode, args: string[]) => [string, string[]],
): Adapter {
  return {
    language,
    modes: ["inline", "file"],
    async detect() { return detectExecutable(language, executables, versionArgs, ["inline", "file"]); },
    async plan(input) {
      const info = await detect(adapters[language]);
      const [command, args] = build(info.executable!, input.source, input.mode, input.args);
      return {command, args, cwd: input.cwd, info};
    },
  };
}

function tempFileAdapter(
  language: CodeLanguage,
  executables: string[],
  versionArgs: string[],
  extension: string,
  build: (exe: string, file: string, args: string[]) => [string, string[]],
  notes?: string[],
  inlineFileName?: string,
): Adapter {
  return {
    language,
    modes: ["inline", "file"],
    async detect() { return detectExecutable(language, executables, versionArgs, ["inline", "file"], notes); },
    async plan(input) {
      const info = await detect(adapters[language]);
      let cleanup: (() => Promise<void>) | undefined;
      let file = input.source;
      if (input.mode === "inline") {
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), `pi-code-${language}-`));
        file = path.join(temp, inlineFileName ?? `main${extension}`);
        await fs.writeFile(file, input.source, "utf8");
        cleanup = () => fs.rm(temp, {recursive: true, force: true});
      }
      const [command, args] = build(info.executable!, file, input.args);
      return {command, args, cwd: input.cwd, cleanup, info};
    },
  };
}

function compiledAdapter(
  language: CodeLanguage,
  compilers: Array<[string, string[]]>,
  extension: string,
  buildCompile: (exe: string, source: string, output: string) => [string, string[]],
): Adapter {
  return {
    language,
    modes: ["inline", "file"],
    async detect() {
      for (const [exe, versionArgs] of compilers) {
        const info = await detectExecutable(language, [exe], versionArgs, ["inline", "file"], ["Compiles to a temporary executable before running."]);
        if (info.available) return info;
      }
      return {language, available: false, modes: ["inline", "file"], error: `No compiler found: ${compilers.map(([it]) => it).join(", ")}`};
    },
    async plan(input) {
      const info = await detect(adapters[language]);
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), `pi-code-${language}-`));
      const source = input.mode === "inline" ? path.join(temp, `main${extension}`) : input.source;
      if (input.mode === "inline") await fs.writeFile(source, input.source, "utf8");
      const output = path.join(temp, process.platform === "win32" ? "program.exe" : "program");
      const [compileCommand, compileArgs] = buildCompile(info.executable!, source, output);
      return {
        command: output,
        args: input.args,
        cwd: input.cwd,
        compile: {command: compileCommand, args: compileArgs, cwd: input.cwd},
        cleanup: () => fs.rm(temp, {recursive: true, force: true}),
        info,
      };
    },
  };
}

async function detectExecutable(language: CodeLanguage, executables: string[], versionArgs: string[], modes: ExecutionMode[], notes?: string[]): Promise<RuntimeInfo> {
  const errors: string[] = [];
  for (const executable of executables) {
    const result = await runProcess({command: executable, args: versionArgs, cwd: process.cwd()}, undefined, 5, undefined, true);
    if (result.spawnError) {
      errors.push(`${executable}: ${result.spawnError}`);
      continue;
    }
    return {
      language,
      available: true,
      executable,
      version: firstLine(`${result.stdout}\n${result.stderr}`),
      modes,
      notes,
    };
  }
  return {language, available: false, modes, error: errors.join("; ") || "not found", notes};
}

function runProcess(
  proc: {command: string; args: string[]; cwd: string},
  stdin: string | undefined,
  timeoutSeconds: number,
  signal?: AbortSignal,
  allowNonZero = false,
): Promise<{stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; spawnError?: string}> {
  return new Promise<{stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; spawnError?: string}>((resolve) => {
    let child;
    try {
      child = spawn(proc.command, proc.args, {cwd: proc.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"]});
    } catch (error) {
      resolve({stdout: "", stderr: "", exitCode: null, timedOut: false, spawnError: error instanceof Error ? error.message : String(error)});
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve({stdout: truncate(stdout), stderr: truncate(stderr), exitCode, timedOut, spawnError});
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 2000).unref();
    }, timeoutSeconds * 1000);
    timeout.unref();
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, {once: true});

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
    if (stdin !== undefined) child.stdin?.end(stdin);
    else child.stdin?.end();
  }).then((result) => allowNonZero ? result : result);
}

function successResult(text: string, details: Record<string, unknown>, isError = false) {
  return {content: [{type: "text" as const, text}], details, isError};
}

function errorResult(text: string, details: Record<string, unknown> = {}) {
  return {content: [{type: "text" as const, text}], details, isError: true};
}

function formatRuntimeInfo(runtimes: RuntimeInfo[]): string {
  return runtimes.map((runtime) => {
    const status = runtime.available ? "available" : "unavailable";
    return [
      `${runtime.language}: ${status}`,
      runtime.executable ? `  executable: ${runtime.executable}` : "",
      runtime.version ? `  version: ${runtime.version}` : "",
      `  modes: ${runtime.modes.join(", ")}`,
      runtime.notes && runtime.notes.length > 0 ? `  notes: ${runtime.notes.join("; ")}` : "",
      runtime.error ? `  error: ${runtime.error}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function formatRunSummary(run: {stdout: string; stderr: string; exitCode: number | null; timedOut: boolean}): string {
  return [
    `Exit code: ${run.exitCode}${run.timedOut ? " (timed out)" : ""}`,
    run.stdout ? `STDOUT:\n${run.stdout}` : "",
    run.stderr ? `STDERR:\n${run.stderr}` : "",
  ].filter(Boolean).join("\n");
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function truncate(value: string): string {
  const max = 50_000;
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value;
}

function minimalContext(cwd: string): ExtensionContext {
  return {cwd, hasUI: false};
}
