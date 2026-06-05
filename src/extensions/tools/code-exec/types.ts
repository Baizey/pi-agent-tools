export const languages = [
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

export type CodeLanguage = typeof languages[number];
export type ExecutionMode = "inline" | "file";

export type ExecInput = {
  language?: unknown;
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
  tempArtifacts?: "inline" | "always";
  detect(): Promise<RuntimeInfo>;
  plan(input: {mode: ExecutionMode; source: string; args: string[]; cwd: string}): Promise<ExecPlan>;
};
