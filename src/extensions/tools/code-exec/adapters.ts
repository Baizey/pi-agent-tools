import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {Adapter, CodeLanguage, ExecPlan, ExecutionMode, RuntimeInfo, TempArtifactMode} from "./types";
import {firstLine, runProcess} from "./process";

const detectionCache = new Map<CodeLanguage, Promise<RuntimeInfo>>();

export async function detectAllRuntimes(): Promise<RuntimeInfo[]> {
  return Promise.all(Object.values(CodeLanguage).map(async (language) => detect(adapters[language])));
}

export async function detect(adapter: Adapter): Promise<RuntimeInfo> {
  let promise = detectionCache.get(adapter.language);
  if (!promise) {
    promise = adapter.detect();
    detectionCache.set(adapter.language, promise);
  }
  return promise;
}

export const adapters: Record<CodeLanguage, Adapter> = {
  javascript: interpreted(CodeLanguage.JAVASCRIPT, ["node"], ["--version"], (exe, source, mode, args) => mode === ExecutionMode.INLINE ? [exe, ["-e", source, ...args]] : [exe, [source, ...args]]),
  typescript: tempFileAdapter(CodeLanguage.TYPESCRIPT, ["tsx", "ts-node"], ["--version"], ".ts", (exe, file, args) => [exe, [file, ...args]]),
  python: interpreted(CodeLanguage.PYTHON, process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"], ["--version"], (exe, source, mode, args) => mode === ExecutionMode.INLINE ? [exe, ["-c", source, ...args]] : [exe, [source, ...args]]),
  powershell: interpreted(CodeLanguage.POWERSHELL, process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"], ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], (exe, source, mode, args) => mode === ExecutionMode.INLINE ? [exe, ["-NoProfile", "-Command", source, ...args]] : [exe, ["-NoProfile", "-File", source, ...args]]),
  ruby: interpreted(CodeLanguage.RUBY, ["ruby"], ["--version"], (exe, source, mode, args) => mode === ExecutionMode.INLINE ? [exe, ["-e", source, ...args]] : [exe, [source, ...args]]),
  php: interpreted(CodeLanguage.PHP, ["php"], ["--version"], (exe, source, mode, args) => mode === ExecutionMode.INLINE ? [exe, ["-r", source, ...args]] : [exe, [source, ...args]]),
  perl: interpreted(CodeLanguage.PERL, ["perl"], ["--version"], (exe, source, mode, args) => mode === ExecutionMode.INLINE ? [exe, ["-e", source, ...args]] : [exe, [source, ...args]]),
  go: tempFileAdapter(CodeLanguage.GO, ["go"], ["version"], ".go", (exe, file, args) => [exe, ["run", file, ...args]]),
  java: tempFileAdapter(CodeLanguage.JAVA, ["java"], ["-version"], ".java", (exe, file, args) => [exe, [file, ...args]], ["Uses Java source-file execution; requires Java 11+."], "Main.java"),
  dotnet: tempFileAdapter(CodeLanguage.DOTNET, ["dotnet-script", "csi"], ["--version"], ".csx", (exe, file, args) => exe === "csi" ? [exe, [file, ...args]] : [exe, [file, "--", ...args]], ["Requires dotnet-script or csi for script execution."]),
  c: compiledAdapter(CodeLanguage.C, [["gcc", ["--version"]], ["clang", ["--version"]]], ".c", (exe, src, out) => [exe, [src, "-o", out]]),
  cpp: compiledAdapter(CodeLanguage.CPP, [["g++", ["--version"]], ["clang++", ["--version"]]], ".cpp", (exe, src, out) => [exe, [src, "-o", out]]),
  rust: compiledAdapter(CodeLanguage.RUST, [["rustc", ["--version"]]], ".rs", (exe, src, out) => [exe, [src, "-o", out]]),
};

function interpreted(
  language: CodeLanguage,
  executables: string[],
  versionArgs: string[],
  build: (exe: string, source: string, mode: ExecutionMode, args: string[]) => [string, string[]],
): Adapter {
  return {
    language,
    modes: [ExecutionMode.INLINE, ExecutionMode.FILE],
    async detect() { return detectExecutable(language, executables, versionArgs, [ExecutionMode.INLINE, ExecutionMode.FILE]); },
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
    modes: [ExecutionMode.INLINE, ExecutionMode.FILE],
    tempArtifacts: TempArtifactMode.INLINE,
    async detect() { return detectExecutable(language, executables, versionArgs, [ExecutionMode.INLINE, ExecutionMode.FILE], notes); },
    async plan(input) {
      const info = await detect(adapters[language]);
      let cleanup: (() => Promise<void>) | undefined;
      let file = input.source;
      if (input.mode === ExecutionMode.INLINE) {
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
    modes: [ExecutionMode.INLINE, ExecutionMode.FILE],
    tempArtifacts: TempArtifactMode.ALWAYS,
    async detect() {
      for (const [exe, versionArgs] of compilers) {
        const info = await detectExecutable(language, [exe], versionArgs, [ExecutionMode.INLINE, ExecutionMode.FILE], ["Compiles to a temporary executable before running."]);
        if (info.available) return info;
      }
      return {language, available: false, modes: [ExecutionMode.INLINE, ExecutionMode.FILE], error: `No compiler found: ${compilers.map(([it]) => it).join(", ")}`};
    },
    async plan(input) {
      const info = await detect(adapters[language]);
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), `pi-code-${language}-`));
      const source = input.mode === ExecutionMode.INLINE ? path.join(temp, `main${extension}`) : input.source;
      if (input.mode === ExecutionMode.INLINE) await fs.writeFile(source, input.source, "utf8");
      const output = path.join(temp, process.platform === "win32" ? "program.exe" : "program");
      const [compileCommand, compileArgs] = buildCompile(info.executable!, source, output);
      return {
        command: output,
        args: input.args,
        cwd: input.cwd,
        compile: {command: compileCommand, args: compileArgs, cwd: input.cwd},
        cleanup: () => fs.rm(temp, {recursive: true, force: true}),
        info,
      } satisfies ExecPlan;
    },
  };
}

async function detectExecutable(language: CodeLanguage, executables: string[], versionArgs: string[], modes: ExecutionMode[], notes?: string[]): Promise<RuntimeInfo> {
  const errors: string[] = [];
  for (const executable of executables) {
    const result = await runProcess({command: executable, args: versionArgs, cwd: process.cwd()}, undefined, 5);
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
