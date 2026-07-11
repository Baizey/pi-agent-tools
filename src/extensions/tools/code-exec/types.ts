import {CodeExecMode} from "../../../policy/types";

export {CodeExecMode};

export enum CodeLanguage {
    JAVASCRIPT = "javascript",
    TYPESCRIPT = "typescript",
    PYTHON = "python",
    POWERSHELL = "powershell",
    RUBY = "ruby",
    PHP = "php",
    PERL = "perl",
    GO = "go",
    JAVA = "java",
    DOTNET = "dotnet",
    C = "c",
    CPP = "cpp",
    RUST = "rust",
}

export enum TempArtifactMode {
    INLINE = "inline",
    ALWAYS = "always",
}

export type ExecInput = {
    language?: unknown;
    purpose?: unknown;
    code?: unknown;
    file?: unknown;
    args?: unknown;
    stdin?: unknown;
    cwd?: unknown;
    timeoutSeconds?: unknown;
};

export type ParsedExecInput = {
    language: CodeLanguage;
    mode: CodeExecMode;
    source: string;
    args: string[];
    stdin?: string;
    cwd: string;
    timeoutSeconds: number;
};

export type RuntimeInfo = {
    language: CodeLanguage;
    available: boolean;
    /** The adapter's provider name (for example, `csi`), independent of its path. */
    provider?: string;
    /** The command or resolved executable path used to launch the provider. */
    executable?: string;
    version?: string;
    error?: string;
    modes: CodeExecMode[];
    notes?: string[];
};

export type DetectedRuntime = RuntimeInfo & {
    available: true;
    provider: string;
    executable: string;
};

export type ProcessSpec = {
    command: string;
    args: string[];
    cwd: string;
};

export type ExecutionPlan = {
    compile?: ProcessSpec;
    run: ProcessSpec;
    cleanup?: () => Promise<void>;
    runtime: DetectedRuntime;
};

export type AdapterPlanInput = Pick<ParsedExecInput, "mode" | "source" | "args" | "cwd">;

export type Adapter = {
    language: CodeLanguage;
    modes: CodeExecMode[];
    tempArtifacts?: TempArtifactMode;
    detect(): Promise<RuntimeInfo>;
    plan(input: AdapterPlanInput, runtime: DetectedRuntime): Promise<ExecutionPlan>;
};

export function isDetectedRuntime(runtime: RuntimeInfo): runtime is DetectedRuntime {
    return runtime.available && typeof runtime.provider === "string" && typeof runtime.executable === "string";
}
