import {PiExtensionApi} from "../../pi/types";
import {agentEnv} from "../../shared/env";
import {toolNames} from "../../shared/toolNames";
import {FoldDirection, renderToolCallInput, renderToolResultOutput} from "../../shared/toolRendering";
import {stringValue} from "../../shared/values";
import {database_filename, SqliteDatabase, SubagentPersonaDao, type SubagentPersonaRow} from "../../storage";
import type {SubagentToolkit} from "../../shared/subagents";
import {errorResult, successResult} from "./responses";
import type {SubagentRequest} from "./runner";
import {defaultTimeoutSecondsForMode, parseSubagentToolkitCeiling, subagentRunModes} from "./toolkits";
import {normalizeTimeout} from "./request";

export type AvailableSubagentPersona = Pick<
  SubagentPersonaRow,
  "name" | "role" | "description" | "mode" | "model" | "toolkits" | "source"
>;

export type RawSubagentPersonaSpawnParams = Record<string, unknown> & {
  persona?: unknown;
  task?: unknown;
  timeoutSeconds?: unknown;
};

export function buildSubagentRequestFromPersona(
  params: RawSubagentPersonaSpawnParams,
  persona: SubagentPersonaRow,
  defaultCwd: string,
): SubagentRequest | {error: string} {
  const task = stringValue(params.task);
  if (!task) return {error: "Missing required parameter: task."};

  const role = stringValue(persona.role);
  if (!role) return {error: `Subagent persona ${persona.name} is misconfigured: missing role.`};
  if (!isSubagentPersonaMode(persona.mode)) return {error: `Subagent persona ${persona.name} is misconfigured: invalid mode ${String(persona.mode)}.`};
  const model = stringValue(persona.model);
  if (!model) return {error: `Subagent persona ${persona.name} is misconfigured: missing model.`};
  const systemPrompt = stringValue(persona.systemPrompt);
  if (!systemPrompt) return {error: `Subagent persona ${persona.name} is misconfigured: missing systemPrompt.`};

  return {
    mode: persona.mode,
    task,
    role,
    persona: persona.name,
    toolkits: persona.toolkits,
    cwd: defaultCwd,
    timeoutSeconds: normalizeTimeout(params.timeoutSeconds, defaultTimeoutSecondsForMode(persona.mode)),
    model,
    systemPrompt,
  };
}

export function registerAvailablePersonasTool(
  pi: PiExtensionApi,
  openDb: () => SqliteDatabase = () => SqliteDatabase.readwrite(database_filename),
): void {
  pi.registerTool?.({
    name: toolNames.availablePersonas,
    label: "Available Personas",
    description: "List enabled subagent persona presets available in the current toolkit context.",
    parameters: availablePersonasParameters(),
    async execute() {
      let db: SqliteDatabase;
      try {
        db = openDb();
      } catch (error) {
        return errorResult(`Could not open subagent persona registry: ${errorMessage(error)}`);
      }

      try {
        const personas = listAvailableSubagentPersonas(db);
        return successResult(formatAvailableSubagentPersonas(personas), {personas});
      } catch (error) {
        return errorResult(errorMessage(error));
      } finally {
        db.close();
      }
    },
    renderCall(args, theme, context) {
      return renderToolCallInput(toolNames.availablePersonas, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      return renderToolResultOutput(result, theme, context, {direction: FoldDirection.HEAD, previewLines: 12});
    },
  });
}

export function availablePersonasParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
}

export function listAvailableSubagentPersonas(
  db: SqliteDatabase,
  toolkitCeiling: readonly SubagentToolkit[] | null = currentSubagentToolkitCeiling(),
): AvailableSubagentPersona[] {
  const dao = new SubagentPersonaDao(db).initializeSchema();
  dao.seedBuiltinPersonas();
  return availableSubagentPersonaSummaries(dao.listEnabledPersonas(), toolkitCeiling);
}

export function currentSubagentToolkitCeiling(): SubagentToolkit[] | null {
  return parseSubagentToolkitCeiling(process.env[agentEnv.subagentToolkitCeiling]);
}

export function availableSubagentPersonaSummaries(
  personas: readonly SubagentPersonaRow[],
  toolkitCeiling: readonly SubagentToolkit[] | null,
): AvailableSubagentPersona[] {
  return personas
    .filter((persona) => areSubagentToolkitsAvailable(persona.toolkits, toolkitCeiling))
    .map(subagentPersonaSummary);
}

export function areSubagentToolkitsAvailable(
  requiredToolkits: readonly SubagentToolkit[],
  toolkitCeiling: readonly SubagentToolkit[] | null,
): boolean {
  return missingSubagentPersonaToolkits(requiredToolkits, toolkitCeiling).length === 0;
}

export function missingSubagentPersonaToolkits(
  requiredToolkits: readonly SubagentToolkit[],
  toolkitCeiling: readonly SubagentToolkit[] | null = currentSubagentToolkitCeiling(),
): SubagentToolkit[] {
  if (toolkitCeiling === null) return [];
  const available = new Set<SubagentToolkit>(toolkitCeiling);
  return requiredToolkits.filter((toolkit) => !available.has(toolkit));
}

export function subagentPersonaSummary(persona: SubagentPersonaRow): AvailableSubagentPersona {
  return {
    name: persona.name,
    role: persona.role,
    description: persona.description,
    mode: persona.mode,
    model: persona.model,
    toolkits: persona.toolkits,
    source: persona.source,
  };
}

export function formatAvailableSubagentPersonas(personas: readonly AvailableSubagentPersona[]): string {
  if (personas.length === 0) return "No available subagent personas in the current context.";
  return [
    "Available subagent personas:",
    ...personas.map((persona) => [
      `- ${persona.name}: ${persona.role}`,
      `  description: ${persona.description}`,
      `  mode: ${persona.mode}; model: ${persona.model}; toolkits: ${persona.toolkits.length > 0 ? persona.toolkits.join(", ") : "(none)"}; source: ${persona.source}`,
    ].join("\n")),
  ].join("\n");
}

function isSubagentPersonaMode(value: unknown): boolean {
  return value === subagentRunModes.sync || value === subagentRunModes.async || value === subagentRunModes.conversation;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
