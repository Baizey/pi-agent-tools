import {subagentRunStatuses, type SubagentRunRow} from "../../../storage";
import {renderSubagentTree} from "./render";
import type {SubagentNode} from "./types";

export enum SubagentTreeFilter {
  all = "all",
  done = "done",
  running = "running",
}

const maxRenderedTreeLines = 200;

export function renderSubagentRunTree(rows: SubagentRunRow[], rootId: string, filter: SubagentTreeFilter = SubagentTreeFilter.all): string[] {
  rows = filterRows(rows, filter);
  const nodes = new Map<string, SubagentNode>();

  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      rootId: row.rootId,
      parentId: row.parentId ?? undefined,
      depth: row.depth,
      mode: row.mode,
      task: row.task,
      role: row.role,
      toolkits: row.profiles,
      tools: row.tools,
      status: row.status,
      latestLine: row.latestLine,
      startedAt: row.startedAt.getTime(),
      finishedAt: row.finishedAt?.getTime(),
      children: [],
    });
  }

  for (const node of nodes.values()) {
    if (!node.parentId) continue;
    const parent = nodes.get(node.parentId);
    if (parent && !parent.children.includes(node.id)) parent.children.push(node.id);
  }

  const order = new Map(rows.map(row => [row.id, row.ordinal]));
  for (const node of nodes.values()) {
    node.children.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  }

  const explicitRoot = nodes.get(rootId);
  const roots = explicitRoot
    ? [explicitRoot]
    : rows
      .filter(row => row.parentId === null)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(row => nodes.get(row.id))
      .filter((node): node is SubagentNode => Boolean(node));

  if (roots.length === 0) return [];

  const rendered = ["Subagents"];
  let omitted = false;
  for (const root of roots) {
    const branch = renderSubagentTree(root, id => nodes.get(id)).slice(1);
    const remaining = maxRenderedTreeLines - (rendered.length - 1);
    if (remaining <= 0) {
      omitted = true;
      break;
    }
    rendered.push(...branch.slice(0, remaining));
    if (branch.length > remaining) {
      omitted = true;
      break;
    }
  }
  if (omitted) rendered.push(`… (additional subagents omitted; display limit ${maxRenderedTreeLines})`);
  return rendered;
}

function filterRows(rows: SubagentRunRow[], filter: SubagentTreeFilter): SubagentRunRow[] {
  if (filter === SubagentTreeFilter.all) return rows;
  const byId = new Map(rows.map(row => [row.id, row]));
  const included = new Set<string>();
  const matches = (row: SubagentRunRow) => filter === SubagentTreeFilter.running
    ? row.status === subagentRunStatuses.starting || row.status === subagentRunStatuses.running
    : row.status === subagentRunStatuses.done
      || row.status === subagentRunStatuses.failed
      || row.status === subagentRunStatuses.cancelled
      || row.status === subagentRunStatuses.timedOut;

  for (const row of rows) {
    if (!matches(row)) continue;
    let current: SubagentRunRow | undefined = row;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      included.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }

  return rows.filter(row => included.has(row.id));
}
