import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    Adapter,
    CodeLanguage,
    CodeExecMode,
    DetectedRuntime,
    ExecutionPlan,
    RuntimeInfo,
    TempArtifactMode
} from "./types";
import {firstLine, ProcessResult, runProcess} from "./process";

type ProcessRunner = (proc: {
    command: string;
    args: string[];
    cwd: string
}, stdin: string | undefined, timeoutSeconds: number) => Promise<ProcessResult>;

/** Resolves a logical provider name to the canonical absolute executable that may be launched. */
export type ExecutableResolver = (provider: string) => Promise<string | undefined>;

export type ExecutableFileSystem = {
    access(file: string, mode?: number): Promise<void>;
    realpath(file: string): Promise<string>;
    stat(file: string): Promise<{ isFile(): boolean }>;
};

export type ExecutableResolverOptions = {
    path?: string;
    pathExt?: string;
    platform?: NodeJS.Platform;
    fileSystem?: ExecutableFileSystem;
};

/**
 * Creates a resolver which cannot implicitly search the child process cwd.
 *
 * Resolution is for `shell: false`: Windows batch/script shims are deliberately
 * excluded. Supporting those requires an explicit interpreter launcher model;
 * this resolver never parses shims or delegates execution to a shell.
 */
export function createExecutableResolver(options: ExecutableResolverOptions = {}): ExecutableResolver {
    const platform = options.platform ?? process.platform;
    const fileSystem: ExecutableFileSystem = options.fileSystem ?? fs;
    const pathApi = platform === "win32" ? path.win32 : path.posix;
    const pathValue = options.path ?? process.env.PATH ?? "";
    const pathExt = options.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
    const separator = platform === "win32" ? ";" : ":";
    const searchDirectories = pathValue.split(separator).filter((entry) => entry !== "" && pathApi.isAbsolute(entry));

    return async (provider: string) => {
        const explicit = pathApi.isAbsolute(provider);
        if (!explicit && (provider.includes("/") || provider.includes("\\"))) return undefined;
        const bases = explicit ? [provider] : searchDirectories.map((directory) => pathApi.join(directory, provider));
        const candidates = platform === "win32" ? windowsCandidates(bases, provider, pathExt, pathApi) : bases;
        for (const candidate of candidates) {
            try {
                await fileSystem.access(candidate, platform === "win32" ? undefined : fs.constants.X_OK);
                const canonical = await fileSystem.realpath(candidate);
                const stats = await fileSystem.stat(canonical);
                if (pathApi.isAbsolute(canonical) && stats.isFile()) return canonical;
            } catch {
                // Try the next directly spawnable PATH/PATHEXT candidate.
            }
        }
        return undefined;
    };
}

function windowsCandidates(bases: string[], provider: string, pathExt: string, pathApi: typeof path.win32): string[] {
    const directlySpawnable = new Set([".exe", ".com"]);
    const extensions = pathExt
        .split(";")
        .filter(Boolean)
        .map((extension) => extension.startsWith(".") ? extension : `.${extension}`)
        .filter((extension) => directlySpawnable.has(extension.toLowerCase()));
    const providerExtension = pathApi.extname(provider);
    if (providerExtension) return directlySpawnable.has(providerExtension.toLowerCase()) ? bases : [];
    return bases.flatMap((base) => extensions.map((extension) => `${base}${extension}`));
}

export class PlanningCleanupError extends Error {
    constructor(readonly planningError: unknown, readonly cleanupError: unknown) {
        super(`Adapter planning failed (${errorMessage(planningError)}) and temporary artifact cleanup also failed (${errorMessage(cleanupError)})`);
        this.name = "PlanningCleanupError";
    }
}

export function createCodeExecAdapters(
    processRunner: ProcessRunner = runProcess,
    executableResolver: ExecutableResolver = createExecutableResolver(),
): Record<CodeLanguage, Adapter> {
    return {
        javascript: interpreted(CodeLanguage.JAVASCRIPT, ["node"], ["--version"], (runtime, source, mode, args) => mode === CodeExecMode.INLINE ? [runtime.executable, ["-e", source, ...args]] : [runtime.executable, [source, ...args]], processRunner, executableResolver),
        typescript: tempFileAdapter(CodeLanguage.TYPESCRIPT, ["tsx", "ts-node"], ["--version"], ".ts", (runtime, file, args) => [runtime.executable, [file, ...args]], undefined, undefined, processRunner, executableResolver),
        python: interpreted(CodeLanguage.PYTHON, process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"], ["--version"], (runtime, source, mode, args) => mode === CodeExecMode.INLINE ? [runtime.executable, ["-c", source, ...args]] : [runtime.executable, [source, ...args]], processRunner, executableResolver),
        powershell: interpreted(CodeLanguage.POWERSHELL, process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"], ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], (runtime, source, mode, args) => mode === CodeExecMode.INLINE ? [runtime.executable, ["-NoProfile", "-Command", source, ...args]] : [runtime.executable, ["-NoProfile", "-File", source, ...args]], processRunner, executableResolver),
        ruby: interpreted(CodeLanguage.RUBY, ["ruby"], ["--version"], (runtime, source, mode, args) => mode === CodeExecMode.INLINE ? [runtime.executable, ["-e", source, ...args]] : [runtime.executable, [source, ...args]], processRunner, executableResolver),
        php: interpreted(CodeLanguage.PHP, ["php"], ["--version"], (runtime, source, mode, args) => mode === CodeExecMode.INLINE ? [runtime.executable, ["-r", source, ...args]] : [runtime.executable, [source, ...args]], processRunner, executableResolver),
        perl: interpreted(CodeLanguage.PERL, ["perl"], ["--version"], (runtime, source, mode, args) => mode === CodeExecMode.INLINE ? [runtime.executable, ["-e", source, ...args]] : [runtime.executable, [source, ...args]], processRunner, executableResolver),
        go: tempFileAdapter(CodeLanguage.GO, ["go"], ["version"], ".go", (runtime, file, args) => [runtime.executable, ["run", file, ...args]], undefined, undefined, processRunner, executableResolver),
        java: tempFileAdapter(CodeLanguage.JAVA, ["java"], ["-version"], ".java", (runtime, file, args) => [runtime.executable, [file, ...args]], ["Uses Java source-file execution; requires Java 11+."], "Main.java", processRunner, executableResolver),
        dotnet: tempFileAdapter(CodeLanguage.DOTNET, ["dotnet-script", "csi"], ["--version"], ".csx", (runtime, file, args) => runtime.provider === "csi" ? [runtime.executable, [file, ...args]] : [runtime.executable, [file, "--", ...args]], ["Requires dotnet-script or csi for script execution."], undefined, processRunner, executableResolver),
        c: compiledAdapter(CodeLanguage.C, [["gcc", ["--version"]], ["clang", ["--version"]]], ".c", (runtime, src, out) => [runtime.executable, [src, "-o", out]], processRunner, executableResolver),
        cpp: compiledAdapter(CodeLanguage.CPP, [["g++", ["--version"]], ["clang++", ["--version"]]], ".cpp", (runtime, src, out) => [runtime.executable, [src, "-o", out]], processRunner, executableResolver),
        rust: compiledAdapter(CodeLanguage.RUST, [["rustc", ["--version"]]], ".rs", (runtime, src, out) => [runtime.executable, [src, "-o", out]], processRunner, executableResolver),
    };
}

function interpreted(
    language: CodeLanguage,
    executables: string[],
    versionArgs: string[],
    build: (runtime: DetectedRuntime, source: string, mode: CodeExecMode, args: string[]) => [string, string[]],
    processRunner: ProcessRunner,
    executableResolver: ExecutableResolver,
): Adapter {
    return {
        language,
        modes: [CodeExecMode.INLINE, CodeExecMode.FILE],
        async detect() {
            return detectExecutable(language, executables, versionArgs, [CodeExecMode.INLINE, CodeExecMode.FILE], processRunner, executableResolver);
        },
        async plan(input, runtime) {
            const [command, args] = build(runtime, input.source, input.mode, input.args);
            return {run: {command, args, cwd: input.cwd}, runtime};
        },
    };
}

function tempFileAdapter(
    language: CodeLanguage,
    executables: string[],
    versionArgs: string[],
    extension: string,
    build: (runtime: DetectedRuntime, file: string, args: string[]) => [string, string[]],
    notes?: string[],
    inlineFileName?: string,
    processRunner: ProcessRunner = runProcess,
    executableResolver: ExecutableResolver = createExecutableResolver(),
): Adapter {
    return {
        language,
        modes: [CodeExecMode.INLINE, CodeExecMode.FILE],
        tempArtifacts: TempArtifactMode.INLINE,
        async detect() {
            return detectExecutable(language, executables, versionArgs, [CodeExecMode.INLINE, CodeExecMode.FILE], processRunner, executableResolver, notes);
        },
        async plan(input, runtime) {
            let temp: string | undefined;
            try {
                let file = input.source;
                if (input.mode === CodeExecMode.INLINE) {
                    temp = await fs.mkdtemp(path.join(os.tmpdir(), `pi-code-${language}-`));
                    file = path.join(temp, inlineFileName ?? `main${extension}`);
                    await fs.writeFile(file, input.source, "utf8");
                }
                const [command, args] = build(runtime, file, input.args);
                const tempToClean = temp;
                return {
                    run: {command, args, cwd: input.cwd},
                    cleanup: tempToClean ? () => fs.rm(tempToClean, {recursive: true, force: true}) : undefined,
                    runtime,
                };
            } catch (error) {
                if (temp) await cleanupAfterPlanningFailure(temp, error);
                throw error;
            }
        },
    };
}

function compiledAdapter(
    language: CodeLanguage,
    compilers: Array<[string, string[]]>,
    extension: string,
    buildCompile: (runtime: DetectedRuntime, source: string, output: string) => [string, string[]],
    processRunner: ProcessRunner,
    executableResolver: ExecutableResolver,
): Adapter {
    return {
        language,
        modes: [CodeExecMode.INLINE, CodeExecMode.FILE],
        tempArtifacts: TempArtifactMode.ALWAYS,
        async detect() {
            const errors: string[] = [];
            for (const [provider, versionArgs] of compilers) {
                const info = await detectExecutable(language, [provider], versionArgs, [CodeExecMode.INLINE, CodeExecMode.FILE], processRunner, executableResolver, ["Compiles to a temporary executable before running."]);
                if (info.available) return info;
                if (info.error) errors.push(info.error);
            }
            return {
                language,
                available: false,
                modes: [CodeExecMode.INLINE, CodeExecMode.FILE],
                error: errors.join("; ") || `No compiler found: ${compilers.map(([it]) => it).join(", ")}`
            };
        },
        async plan(input, runtime) {
            const temp = await fs.mkdtemp(path.join(os.tmpdir(), `pi-code-${language}-`));
            try {
                const source = input.mode === CodeExecMode.INLINE ? path.join(temp, `main${extension}`) : input.source;
                if (input.mode === CodeExecMode.INLINE) await fs.writeFile(source, input.source, "utf8");
                const output = path.join(temp, process.platform === "win32" ? "program.exe" : "program");
                const [command, args] = buildCompile(runtime, source, output);
                return {
                    compile: {command, args, cwd: input.cwd},
                    run: {command: output, args: input.args, cwd: input.cwd},
                    cleanup: () => fs.rm(temp, {recursive: true, force: true}),
                    runtime,
                } satisfies ExecutionPlan;
            } catch (error) {
                await cleanupAfterPlanningFailure(temp, error);
                throw error;
            }
        },
    };
}

async function detectExecutable(
    language: CodeLanguage,
    providers: string[],
    versionArgs: string[],
    modes: CodeExecMode[],
    processRunner: ProcessRunner,
    executableResolver: ExecutableResolver,
    notes?: string[],
): Promise<RuntimeInfo> {
    const errors: string[] = [];
    for (const provider of providers) {
        const executable = await executableResolver(provider);
        if (!executable || !path.isAbsolute(executable)) {
            errors.push(`${provider}: executable not found as a canonical absolute path`);
            continue;
        }
        const result = await processRunner({command: executable, args: versionArgs, cwd: process.cwd()}, undefined, 5);
        const failure = detectionFailure(result);
        if (failure) {
            errors.push(`${provider}: ${failure}`);
            continue;
        }
        return {
            language,
            available: true,
            provider,
            executable,
            version: firstLine(`${result.stdout}\n${result.stderr}`),
            modes,
            notes,
        };
    }
    return {language, available: false, modes, error: errors.join("; ") || "not found", notes};
}

function detectionFailure(result: ProcessResult): string | undefined {
    if (result.spawnError) return `spawn failed: ${result.spawnError}`;
    if (result.cancelled) return "detection was cancelled";
    if (result.timedOut) return "detection timed out";
    if (result.exitCode !== 0) {
        const detail = firstLine(`${result.stderr}\n${result.stdout}`);
        return `version command exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`;
    }
    return undefined;
}

async function cleanupAfterPlanningFailure(temp: string, planningError: unknown): Promise<never> {
    try {
        await fs.rm(temp, {recursive: true, force: true});
    } catch (cleanupError) {
        throw new PlanningCleanupError(planningError, cleanupError);
    }
    throw planningError;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
