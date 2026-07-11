import {PiExtensionApi, ExtensionContext} from "../../pi/types";
import {database_filename, isValidSubagentPersonaName, SqliteDatabase, SubagentDao, SubagentPersonaDao, type SubagentPersonaRow} from "../../storage";
import {AgentModelProfile, agentModelProfiles, isAgentModelProfile, renderModelProfileConfig} from "./model-profiles";
import {autoModelProfileConfig, ModelProfileConfigStore, normalizeConfigValue} from "./model-profile-config";
import {renderLines} from "../../shared/toolRendering";
import {renderSubagentRunTree, SubagentTreeFilter, subagentTreeRowLimit} from "./tree-ui";

type SubagentWidgetState = {
  enabled: boolean;
  filter: SubagentTreeFilter;
  rootId?: string;
};

const widgetState: SubagentWidgetState = {
  enabled: false,
  filter: SubagentTreeFilter.all,
};

export function registerSubagentCommands(pi: PiExtensionApi): void {
  registerModelProfileCommand(pi);
  registerPersonasCommand(pi);

  pi.on?.("session_start", (event, ctx) => {
    if (event.reason === "reload") return;
    widgetState.enabled = true;
    widgetState.filter = SubagentTreeFilter.running;
    widgetState.rootId = ctx.sessionManager?.getSessionId() ?? widgetState.rootId;
    refreshSubagentWidget(ctx);
  });

  pi.registerCommand?.("subagents", {
    description: "Show or hide the subagent tree widget. Usage: /subagents [on|off] [all|done|running]",
    getArgumentCompletions(prefix) {
      const parts = prefix.trim().split(/\s+/).filter(Boolean);
      const filters = Object.values(SubagentTreeFilter);
      const options = parts.length <= 1 ? ["on", "off", ...filters] : filters;
      const current = parts.length > 0 ? parts[parts.length - 1] : "";
      return options
        .filter(option => option.startsWith(current))
        .map(option => ({value: option, label: option}));
    },
    handler(args, ctx) {
      const parsed = parseSubagentCommandArgs(args);
      if (parsed.error) {
        ctx.ui?.notify?.(parsed.error, "error");
        return;
      }

      widgetState.enabled = parsed.enabled;
      widgetState.filter = parsed.filter;
      widgetState.rootId = ctx.sessionManager?.getSessionId() ?? widgetState.rootId;

      refreshSubagentWidget(ctx);
      ctx.ui?.notify?.(
        widgetState.enabled
          ? `Subagent widget on (${widgetState.filter}).`
          : "Subagent widget off.",
        "info",
      );
    },
  });
}

function registerPersonasCommand(pi: PiExtensionApi): void {
  pi.registerCommand?.("personas", {
    description: "List subagent personas or show details. Usage: /personas [list] | show <name>",
    getArgumentCompletions(prefix) {
      return personaCommandCompletionOptions(prefix).map(option => ({value: option, label: option}));
    },
    handler(args, ctx) {
      const parsed = parsePersonasCommandArgs(args);
      if (parsed.action === "error") {
        ctx.ui?.notify?.(parsed.error, "error");
        return;
      }

      try {
        const lines = withSubagentPersonaRegistry(dao => {
          if (parsed.action === "show") {
            const persona = dao.getPersona(parsed.name);
            return persona
              ? renderSubagentPersonaDetails(persona)
              : [`Unknown subagent persona: ${parsed.name}`];
          }
          return renderSubagentPersonaList(dao.listPersonas());
        });
        ctx.ui?.notify?.(lines.join("\n"), parsed.action === "show" && lines[0]?.startsWith("Unknown") ? "error" : "info");
      } catch (error) {
        ctx.ui?.notify?.(`Failed to read subagent personas: ${errorMessage(error)}`, "error");
      }
    },
  });
}

export type PersonasCommand =
  | {action: "list"}
  | {action: "show"; name: string}
  | {action: "error"; error: string};

export function parsePersonasCommandArgs(args: string): PersonasCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {action: "list"};
  if (parts.length === 1 && parts[0] === "list") return {action: "list"};

  if (parts[0] === "show") {
    if (parts.length !== 2) return {action: "error", error: "Usage: /personas show <name>"};
    if (!isValidSubagentPersonaName(parts[1])) return {action: "error", error: `Invalid subagent persona name: ${parts[1]}`};
    return {action: "show", name: parts[1]};
  }

  return {action: "error", error: "Usage: /personas [list] | show <name>"};
}

export function renderSubagentPersonaList(personas: readonly SubagentPersonaRow[]): string[] {
  if (personas.length === 0) return ["Subagent personas", "No personas found."];
  return [
    `Subagent personas (${personas.length})`,
    ...personas.flatMap(persona => [
      `- ${persona.name}${persona.enabled ? "" : " [disabled]"} — ${persona.role}`,
      `  ${persona.description}`,
      `  ${persona.mode} · ${persona.model} · toolkits: ${formatPersonaToolkits(persona.toolkits)} · source: ${persona.source}`,
    ]),
    "",
    "Use /personas show <name> for full details and system prompt.",
  ];
}

export function renderSubagentPersonaDetails(persona: SubagentPersonaRow): string[] {
  return [
    `Subagent persona: ${persona.name}`,
    `Role: ${persona.role}`,
    `Description: ${persona.description}`,
    `Mode: ${persona.mode}`,
    `Model: ${persona.model}`,
    `Toolkits: ${formatPersonaToolkits(persona.toolkits)}`,
    `Source: ${persona.source}`,
    `Enabled: ${persona.enabled ? "yes" : "no"}`,
    `Created: ${formatPersonaDate(persona.createdAt)}`,
    `Updated: ${formatPersonaDate(persona.updatedAt)}`,
    "System prompt:",
    persona.systemPrompt,
  ];
}

function withSubagentPersonaRegistry<T>(fn: (dao: SubagentPersonaDao) => T): T {
  const db = SqliteDatabase.readwrite(database_filename);
  try {
    const dao = new SubagentPersonaDao(db).initializeSchema();
    dao.seedBuiltinPersonas();
    return fn(dao);
  } finally {
    db.close();
  }
}

function personaCommandCompletionOptions(prefix: string): string[] {
  const hasTrailingWhitespace = /\s$/.test(prefix);
  const parts = prefix.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ["list", "show"];

  if (parts[0] === "show") {
    if (parts.length === 1 && hasTrailingWhitespace) return personaNameCompletionOptions("");
    if (parts.length === 2 && !hasTrailingWhitespace) return personaNameCompletionOptions(parts[1]);
    return [];
  }

  if (parts.length === 1 && !hasTrailingWhitespace) {
    return ["list", "show"].filter(option => option.startsWith(parts[0]));
  }

  return [];
}

function personaNameCompletionOptions(prefix: string): string[] {
  try {
    return withSubagentPersonaRegistry(dao => dao.listPersonas().map(persona => persona.name))
      .filter(name => name.startsWith(prefix));
  } catch {
    return [];
  }
}

function formatPersonaToolkits(toolkits: readonly string[]): string {
  return toolkits.length > 0 ? toolkits.join(", ") : "(none)";
}

function formatPersonaDate(value: Date): string {
  return Number.isNaN(value.getTime()) ? "(unknown)" : value.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function registerModelProfileCommand(pi: PiExtensionApi): void {
  pi.registerCommand?.("model-profiles", {
    description: "Show or configure model profile resolution. Usage: /model-profiles [profile auto|model] | reset [profile]",
    getArgumentCompletions(prefix) {
      const parts = prefix.trim().split(/\s+/).filter(Boolean);
      const current = parts.length > 0 ? parts[parts.length - 1] : "";
      const options = modelProfileCompletionOptions(parts);
      return options
        .filter(option => option.startsWith(current))
        .map(option => ({value: option, label: option}));
    },
    async handler(args, ctx) {
      const parsed = parseModelProfileCommandArgs(args);
      if (parsed.action === "error") {
        ctx.ui?.notify?.(parsed.error, "error");
        return;
      }

      const store = new ModelProfileConfigStore();
      if (parsed.action === "set") {
        store.set(parsed.profile, parsed.value);
      } else if (parsed.action === "reset") {
        store.reset(parsed.profile);
      }

      const lines = await renderModelProfileConfig(ctx, store.load());
      ctx.ui?.notify?.(lines.join("\n"), "info");
    },
  });
}

export function updateSubagentWidget(ctx: Pick<ExtensionContext, "ui" | "sessionManager"> | undefined, rootId?: string): void {
  if (!widgetState.enabled) return;
  if (rootId) widgetState.rootId = rootId;
  else if (ctx?.sessionManager?.getSessionId()) widgetState.rootId = ctx.sessionManager.getSessionId();
  refreshSubagentWidget(ctx);
}

function refreshSubagentWidget(ctx: Pick<ExtensionContext, "ui"> | undefined): void {
  if (!ctx?.ui?.setWidget) return;
  if (!widgetState.enabled) {
    ctx.ui.setWidget("subagents", []);
    return;
  }

  const rootId = widgetState.rootId;
  if (!rootId) {
    setSubagentWidgetLines(ctx, ["Subagents", "└─ No session id available"]);
    return;
  }

  const db = SqliteDatabase.readwrite(database_filename);
  try {
    const dao = new SubagentDao(db).initializeSchema();
    const rows = dao.listTree(rootId, subagentTreeRowLimit + 1);
    const lines = renderSubagentRunTree(rows, rootId, widgetState.filter);
    setSubagentWidgetLines(ctx, lines.length > 0 ? lines : ["Subagents", "└─ No subagents"]);
  } finally {
    db.close();
  }
}

function setSubagentWidgetLines(ctx: Pick<ExtensionContext, "ui">, lines: string[]): void {
  ctx.ui?.setWidget?.("subagents", () => renderLines(lines));
}

function parseSubagentCommandArgs(args: string): {enabled: boolean; filter: SubagentTreeFilter; error?: string} {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {enabled: !widgetState.enabled, filter: widgetState.filter};

  let enabled = true;
  let filter: SubagentTreeFilter = widgetState.filter;

  for (const part of parts) {
    if (part === "on") {
      enabled = true;
      continue;
    }
    if (part === "off") {
      enabled = false;
      continue;
    }
    if (isFilter(part)) {
      filter = part;
      continue;
    }
    return {enabled, filter, error: `Unknown /subagents option: ${part}`};
  }

  return {enabled, filter};
}

export type ModelProfileCommand =
  | {action: "show"}
  | {action: "set"; profile: AgentModelProfile; value: string}
  | {action: "reset"; profile?: AgentModelProfile}
  | {action: "error"; error: string};

export function parseModelProfileCommandArgs(args: string): ModelProfileCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {action: "show"};

  if (parts[0] === "reset") {
    if (parts.length === 1) return {action: "reset"};
    if (parts.length === 2 && isAgentModelProfile(parts[1])) return {action: "reset", profile: parts[1]};
    return {action: "error", error: `Usage: /model-profiles reset [${Object.values(agentModelProfiles).join("|")}]`};
  }

  if (!isAgentModelProfile(parts[0])) {
    return {action: "error", error: `Unknown model profile: ${parts[0]}`};
  }
  if (parts.length < 2) {
    return {action: "error", error: `Missing model value for ${parts[0]}. Use '${autoModelProfileConfig}' or a concrete provider/model id.`};
  }
  if (parts.length > 2) {
    return {action: "error", error: "Model profile values cannot contain whitespace."};
  }

  return {action: "set", profile: parts[0], value: normalizeConfigValue(parts[1])};
}

function modelProfileCompletionOptions(parts: string[]): string[] {
  if (parts.length <= 1) return ["reset", ...Object.values(agentModelProfiles)];
  if (parts[0] === "reset") return Object.values(agentModelProfiles);
  if (isAgentModelProfile(parts[0]) && parts.length === 2) return [autoModelProfileConfig];
  return [];
}

function isFilter(value: string): value is SubagentTreeFilter {
  return Object.values(SubagentTreeFilter).some((filter) => filter === value);
}
