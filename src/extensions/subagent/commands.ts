import {PiExtensionApi, ExtensionContext} from "../../pi/types";
import {database_filename, SqliteDatabase, SubagentDao} from "../../storage";
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

function isFilter(value: string): value is SubagentTreeFilter {
  return (filterValues as string[]).includes(value);
}
