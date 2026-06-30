import {PiExtensionApi, ExtensionContext} from "../../pi/types";
import {database_filename, SqliteDatabase, SubagentDao} from "../../storage";
import {AgentModelProfile, agentModelProfiles, isAgentModelProfile, renderModelProfileConfig} from "./model-profiles";
import {autoModelProfileConfig, ModelProfileConfigStore, normalizeConfigValue} from "./model-profile-config";
import {renderSubagentRunTree, SubagentTreeFilter} from "./tree-ui";

const filterValues = Object.values(SubagentTreeFilter);

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
      const options = parts.length <= 1 ? ["on", "off", ...filterValues] : filterValues;
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
    ctx.ui.setWidget("subagents", ["Subagents", "└─ No session id available"]);
    return;
  }

  const db = SqliteDatabase.readwrite(database_filename);
  try {
    const dao = new SubagentDao(db).initializeSchema();
    const lines = renderSubagentRunTree(dao.listTree(rootId), rootId, widgetState.filter);
    ctx.ui.setWidget("subagents", lines.length > 0 ? lines : ["Subagents", "└─ No subagents"]);
  } finally {
    db.close();
  }
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
  return (filterValues as string[]).includes(value);
}
