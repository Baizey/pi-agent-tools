import {ExtensionContext} from "../../pi/types";
import {CodeExecEffectsReport, CodeExecMode, FsAccessType} from "../../policy/types";
import {agentEnv} from "../../shared/env";
import {agentModelProfiles, resolveAgentModelProfile, runSyncSubagent, subagentProfileNames} from "../subagent";

export type CodeExecAnalysisInput = {
  language: string;
  mode: CodeExecMode;
  source: string;
  args: string[];
  stdin?: string;
  cwd: string;
};

export async function analyzeCodeExecutionEffects(
  ctx: ExtensionContext,
  input: CodeExecAnalysisInput,
): Promise<CodeExecEffectsReport | null> {
  try {
    const model = await resolveAgentModelProfile(ctx, process.env[agentEnv.subagentModel]?.trim() || agentModelProfiles.textLow);
    const result = await runSyncSubagent({
      task: analysisPrompt(input),
      profiles: [subagentProfileNames.none],
      cwd: input.cwd,
      timeoutSeconds: 30,
      model,
      systemPrompt: "You statically analyze code for approval UI. Do not execute code. Do not call tools. Output only valid JSON matching the requested schema.",
    }, ctx.signal);
    return parseEffectsReport(result.output);
  } catch {
    return null;
  }
}

export function formatEffectsReport(report: CodeExecEffectsReport | null): string {
  if (!report) return "Likely effects: unavailable; static analysis did not complete.";
  const lines = [
    `Likely effects (${report.confidence} confidence): ${report.summary}`,
  ];
  if (report.paths.length > 0) {
    lines.push("Likely path effects:");
    for (const path of report.paths.slice(0, 8)) {
      lines.push(`- ${path.accessTypes.join("/")} ${path.path} (${path.confidence}): ${path.reason}`);
    }
  }
  if (report.processEffects.length > 0) lines.push(`Process effects: ${report.processEffects.join("; ")}`);
  if (report.networkEffects.length > 0) lines.push(`Network effects: ${report.networkEffects.join("; ")}`);
  if (report.environmentEffects.length > 0) lines.push(`Environment effects: ${report.environmentEffects.join("; ")}`);
  if (report.unknowns.length > 0) lines.push(`Unknowns: ${report.unknowns.join("; ")}`);
  return lines.join("\n");
}

function analysisPrompt(input: CodeExecAnalysisInput): string {
  const sourceLabel = input.mode === "inline" ? "Inline code" : "File contents";
  return [
    `Analyze this ${input.language} ${input.mode} execution statically.`,
    "Explain what it is likely to do. This is for human approval UI, not enforcement completeness.",
    "Identify concrete filesystem paths that appear likely to be read, written, edited, deleted, or executed.",
    "Use only concrete paths visible from the code/source. Put dynamic/uncertain effects in unknowns.",
    "Do not put reassuring non-unknown statements in unknowns. If there are no important uncertainties, use an empty unknowns array.",
    "Base confidence on how direct/static the evidence is: high for literal obvious operations, medium for ordinary indirection, low for dynamic/opaque behavior.",
    "For simple pure computations, say so directly and leave paths/processEffects/networkEffects/environmentEffects/unknowns empty.",
    "Return only valid JSON with this shape:",
    JSON.stringify({
      summary: "one concise sentence",
      confidence: "low|medium|high",
      paths: [{path: "relative/or/absolute/path", accessTypes: ["READ"], reason: "why", confidence: "low|medium|high"}],
      processEffects: ["subprocesses or compilers likely used"],
      networkEffects: ["network behavior likely used"],
      environmentEffects: ["env vars likely read/changed"],
      unknowns: ["important uncertainty"],
    }),
    `cwd: ${JSON.stringify(input.cwd)}`,
    `args: ${JSON.stringify(input.args)}`,
    `stdin provided: ${input.stdin === undefined ? "no" : "yes"}`,
    `${sourceLabel}:`,
    input.source.slice(0, 30_000),
  ].join("\n");
}

function parseEffectsReport(output: string): CodeExecEffectsReport | null {
  const text = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(text) as Partial<CodeExecEffectsReport>;
  const report: CodeExecEffectsReport = {
    summary: typeof parsed.summary === "string" ? parsed.summary : "No summary provided.",
    confidence: normalizeConfidence(parsed.confidence),
    paths: Array.isArray(parsed.paths) ? parsed.paths.map(normalizePathEffect).filter((it): it is CodeExecEffectsReport["paths"][number] => it !== null) : [],
    processEffects: stringArray(parsed.processEffects),
    networkEffects: stringArray(parsed.networkEffects),
    environmentEffects: stringArray(parsed.environmentEffects),
    unknowns: stringArray(parsed.unknowns).filter(isActualUnknown),
  };
  return report;
}

function normalizePathEffect(value: unknown): CodeExecEffectsReport["paths"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (!path) return null;
  const accessTypes = Array.isArray(record.accessTypes)
    ? record.accessTypes.filter((it): it is FsAccessType => typeof it === "string" && Object.values(FsAccessType).includes(it as FsAccessType))
    : [];
  if (accessTypes.length === 0) return null;
  return {
    path,
    accessTypes: [...new Set(accessTypes)],
    reason: typeof record.reason === "string" ? record.reason : "Static analysis inferred this path effect.",
    confidence: normalizeConfidence(record.confidence),
  };
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((it): it is string => typeof it === "string" && it.trim() !== "").slice(0, 12) : [];
}

function isActualUnknown(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized !== ""
    && !normalized.startsWith("no ")
    && !normalized.startsWith("none")
    && !normalized.includes("no filesystem")
    && !normalized.includes("no important uncertainties")
    && !normalized.includes("nothing uncertain");
}
