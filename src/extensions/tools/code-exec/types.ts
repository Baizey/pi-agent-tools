import {CodeExecMode} from "../../../policy/types";

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

export import ExecutionMode = CodeExecMode;

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
  mode: ExecutionMode;
  source: string;
  args: string[];
  stdin?: string;
  cwd: string;
  timeoutSeconds: number;
};

export type RuntimeInfo = {
  language: CodeLanguage;
  available: boolean;
  executable?: string;
  version?: string;
  error?: string;
  modes: ExecutionMode[];
  notes?: string[];
};

export type ExecPlan = {
  command: string;
  args: string[];
  cwd: string;
  cleanup?: () => Promise<void>;
  compile?: {command: string; args: string[]; cwd: string};
  info: RuntimeInfo;
};

export type Adapter = {
  language: CodeLanguage;
  modes: ExecutionMode[];
  tempArtifacts?: TempArtifactMode;
  detect(): Promise<RuntimeInfo>;
  plan(input: {mode: ExecutionMode; source: string; args: string[]; cwd: string}): Promise<ExecPlan>;
};
