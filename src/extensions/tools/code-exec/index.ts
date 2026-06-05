import fs from "node:fs/promises";
import os from "node:os";
import {ExtensionContext, PiExtensionApi} from "../../../pi/types";
import {AgentServices} from "../../../pi/runtime";
import {CodeExecEffectsReport, FsAccessType} from "../../../policy/types";
import {agentEnv, isAgentEnvEnabled} from "../../../shared/env";
import {toolNames} from "../../../shared/toolNames";
import {renderToolCallInput} from "../../../shared/toolRendering";
import {errorResult, successResult} from "../../../shared/toolResults";
import {stringValue} from "../../../shared/values";
import {ensurePathAllowed} from "../../policy/path-policy";
import {adapters, detect, detectAllRuntimes} from "./adapters";
import {analyzeCodeExecutionEffects} from "./analysis";
import {CodeExecApprovalInput, ensureCodeExecAllowed} from "./approval";
import {codeApprovalContext, contextForCwd, executeCodeParameters, isLanguage, parseInput} from "./input";
import {runProcess} from "./process";
import {formatRuntimeInfo, formatRunSummary, renderCodeExecCall} from "./rendering";
import {Adapter, languages} from "./types";

export async function registerCodeExecutionTool(pi: PiExtensionApi, services: AgentServices): Promise<void> {
  const runtimeInfo = await detectAllRuntimes();
  const availableLanguages = runtimeInfo.filter((result) => result.available).map((result) => result.language);

  pi.registerTool?.({
    name: toolNames.executeCode,
    label: "Execute Code",
    description: "Execute code from an inline snippet or file using a detected language runtime. Uses direct process spawning, not a shell.",
    parameters: executeCodeParameters(availableLanguages),
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const parsed = parseInput(rawParams, ctx?.cwd ?? process.cwd());
      if ("error" in parsed) return errorResult(parsed.error);

      const runtime = services.runtimeFor(parsed.cwd);
      const effectiveCtx = contextForCwd(ctx, parsed.cwd);
      const pathDenyByDefault = isAgentEnvEnabled(agentEnv.pathDenyByDefault);
      const cwdReason = await ensurePathAllowed(effectiveCtx, runtime, parsed.cwd, FsAccessType.EXECUTE, pathDenyByDefault);
      if (cwdReason) return errorResult(cwdReason, {blocked: true});

      if (parsed.mode === "file") {
        const readReason = await ensurePathAllowed(effectiveCtx, runtime, parsed.source, FsAccessType.READ, pathDenyByDefault);
        if (readReason) return errorResult(readReason, {blocked: true});
        const executeReason = await ensurePathAllowed(effectiveCtx, runtime, parsed.source, FsAccessType.EXECUTE, pathDenyByDefault);
        if (executeReason) return errorResult(executeReason, {blocked: true});
      }

      let effectsReport: CodeExecEffectsReport | null | undefined;
      const loadEffectsReport = async () => {
        const sourceForAnalysis = parsed.mode === "file"
          ? await fs.readFile(parsed.source, "utf8").catch(() => undefined)
          : parsed.source;
        effectsReport = sourceForAnalysis === undefined
          ? null
          : await analyzeCodeExecutionEffects(effectiveCtx, {...parsed, source: sourceForAnalysis});
        return effectsReport;
      };

      const input = {
        parsed,
        language: parsed.language,
        mode: parsed.mode,
        context: codeApprovalContext(parsed),
        loadEffectsReport,
        onEffectsReport: (report) => { effectsReport = report; },
      } satisfies CodeExecApprovalInput
      const codeExecReason = await ensureCodeExecAllowed(
        effectiveCtx,
        runtime,
          input,
        isAgentEnvEnabled(agentEnv.codeExecDenyByDefault),
      );
      if (codeExecReason) return errorResult(codeExecReason, {blocked: true, effectsReport: effectsReport ?? null});

      const preflightReason = await ensureInferredPathEffectsAllowed(
        effectiveCtx,
        runtime,
        effectsReport ?? null,
        isAgentEnvEnabled(agentEnv.pathDenyByDefault),
      );
      if (preflightReason) return errorResult(preflightReason, {blocked: true, effectsReport: effectsReport ?? null});

      const adapter = adapters[parsed.language];
      const info = await detect(adapter);
      if (!info.available) return errorResult(`Runtime unavailable for ${parsed.language}: ${info.error ?? "not found"}`, {runtime: info});
      if (!info.modes.includes(parsed.mode)) return errorResult(`${parsed.language} does not support ${parsed.mode} execution.`, {runtime: info});

      const tempArtifactReason = await ensureTempArtifactsAllowed(effectiveCtx, runtime, adapter, parsed.mode, pathDenyByDefault);
      if (tempArtifactReason) return errorResult(tempArtifactReason, {blocked: true});

      const plan = await adapter.plan(parsed);
      try {
        const compile = plan.compile ? await runProcess(plan.compile, parsed.stdin, parsed.timeoutSeconds, signal) : undefined;
        if (compile && compile.exitCode !== 0) {
          return successResult("Compilation failed.", {runtime: plan.info, compile, run: null}, true);
        }
        const run = await runProcess(plan, parsed.stdin, parsed.timeoutSeconds, signal);
        return successResult(formatRunSummary(run), {runtime: plan.info, compile: compile ?? null, run}, run.exitCode !== 0 || run.timedOut);
      } finally {
        await plan.cleanup?.().catch(() => undefined);
      }
    },
    renderCall(args, theme) {
      return renderCodeExecCall(args, theme as never);
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
      const results = rawLanguage && isLanguage(rawLanguage) ? [await detect(adapters[rawLanguage])] : await detectAllRuntimes();
      return successResult(formatRuntimeInfo(results), {runtimes: results});
    },
    renderCall(args, theme) {
      return renderToolCallInput(toolNames.executeCodeInfo, args, theme as never);
    },
  });
}

async function ensureInferredPathEffectsAllowed(
  ctx: ExtensionContext,
  runtime: ReturnType<AgentServices["runtimeFor"]>,
  report: CodeExecEffectsReport | null,
  denyByDefault: boolean,
): Promise<string | null> {
  if (!report) return null;
  for (const effect of report.paths) {
    if (effect.confidence !== "high" || !isConcretePathEffect(effect.path)) continue;
    for (const accessType of effect.accessTypes) {
      const reason = await ensurePathAllowed(ctx, runtime, effect.path, accessType, denyByDefault);
      if (reason) return `Static analysis inferred path effect before code execution.\nPath: ${effect.path}\nAccess: ${accessType}\nReason: ${effect.reason}\n\n${reason}`;
    }
  }
  return null;
}

function isConcretePathEffect(candidatePath: string): boolean {
  return candidatePath.trim() !== ""
    && !/[*$?{}]/.test(candidatePath)
    && !candidatePath.includes("...")
    && !candidatePath.includes("<")
    && !candidatePath.includes(">");
}

async function ensureTempArtifactsAllowed(
  ctx: ExtensionContext,
  runtime: ReturnType<AgentServices["runtimeFor"]>,
  adapter: Adapter,
  mode: "inline" | "file",
  denyByDefault: boolean,
): Promise<string | null> {
  const usesTempArtifacts = adapter.tempArtifacts === "always" || (adapter.tempArtifacts === "inline" && mode === "inline");
  if (!usesTempArtifacts) return null;

  const tempRoot = os.tmpdir();
  for (const accessType of [FsAccessType.WRITE, FsAccessType.READ, FsAccessType.EXECUTE]) {
    const reason = await ensurePathAllowed(ctx, runtime, tempRoot, accessType, denyByDefault);
    if (reason) {
      return `Code execution needs temporary ${adapter.language} artifacts under ${tempRoot}.\nAccess: ${accessType}\n\n${reason}`;
    }
  }
  return null;
}
