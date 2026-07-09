import {subagentRunStatuses, type SubagentRunRow} from "../../../storage";
import {defaultSubagentTreeRenderLimits, renderSubagentTree} from "./render";
import type {SubagentNode} from "./types";

export enum SubagentTreeFilter {
  all = "all",
  done = "done",
  running = "running",
}

const maxRenderedTreeLines = 201;
export const subagentTreeRowLimit = 5_000;

type IndexedTree = {
  nodes: Map<string, SubagentNode>;
  roots: SubagentNode[];
};

export function renderSubagentRunTree(
  rows: SubagentRunRow[],
  rootId: string,
  filter: SubagentTreeFilter = SubagentTreeFilter.all,
): string[] {
  const indexedRows = rows.slice(0, subagentTreeRowLimit);
  const visibleRows = filterRows(indexedRows, filter);
  const tree = indexTree(visibleRows, rootId);
  const lines = renderForest(tree);
  return rows.length > indexedRows.length ? withRowLimitNotice(lines) : lines;
}

function indexTree(rows: SubagentRunRow[], rootId: string): IndexedTree {
  const nodes = new Map(rows.map(row => [row.id, nodeFromRow(row)]));
  const ordinalById = new Map(rows.map(row => [row.id, row.ordinal]));

  for (const node of nodes.values()) {
    if (!node.parentId) continue;
    const parent = nodes.get(node.parentId);
    if (parent) parent.children.push(node.id);
  }

  for (const node of nodes.values()) {
    node.children.sort((left, right) => (ordinalById.get(left) ?? 0) - (ordinalById.get(right) ?? 0));
  }

  const explicitRoot = nodes.get(rootId);
  const roots = explicitRoot
    ? [explicitRoot]
    : [...nodes.values()]
      .filter(node => !node.parentId || !nodes.has(node.parentId))
      .sort((left, right) => (ordinalById.get(left.id) ?? 0) - (ordinalById.get(right.id) ?? 0));

  return {nodes, roots};
}

function nodeFromRow(row: SubagentRunRow): SubagentNode {
  return {
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
  };
}

function renderForest(tree: IndexedTree): string[] {
  if (tree.roots.length === 0) return [];

  const lines = ["Subagents"];
  for (let index = 0; index < tree.roots.length; index++) {
    const available = maxRenderedTreeLines - lines.length;
    if (available <= 0) return replaceLastLineWithForestNotice(lines);

    const branch = renderSubagentTree(
      tree.roots[index],
      id => tree.nodes.get(id),
      {...defaultSubagentTreeRenderLimits, maxLines: available + 1},
    ).slice(1);
    lines.push(...branch);

    const hasMoreRoots = index < tree.roots.length - 1;
    if (hasMoreRoots && lines.length >= maxRenderedTreeLines) {
      return replaceLastLineWithForestNotice(lines);
    }
  }

  return lines;
}

function withRowLimitNotice(lines: string[]): string[] {
  const notice = "… (additional persisted subagent rows omitted)";
  if (lines.length === 0) return ["Subagents", notice];
  return lines.length < maxRenderedTreeLines
    ? [...lines, notice]
    : [...lines.slice(0, -1), notice];
}

function replaceLastLineWithForestNotice(lines: string[]): string[] {
  const notice = `… (additional subagents omitted; display limit ${maxRenderedTreeLines})`;
  return lines.length < maxRenderedTreeLines
    ? [...lines, notice]
    : [...lines.slice(0, -1), notice];
}

function filterRows(rows: SubagentRunRow[], filter: SubagentTreeFilter): SubagentRunRow[] {
  if (filter === SubagentTreeFilter.all) return rows;

  const rowsById = new Map(rows.map(row => [row.id, row]));
  const includedIds = new Set<string>();
  for (const row of rows) {
    if (matchesFilter(row, filter)) includeAncestors(row, rowsById, includedIds);
  }
  return rows.filter(row => includedIds.has(row.id));
}

function matchesFilter(row: SubagentRunRow, filter: SubagentTreeFilter): boolean {
  if (filter === SubagentTreeFilter.running) {
    return row.status === subagentRunStatuses.starting || row.status === subagentRunStatuses.running;
  }
  return row.status === subagentRunStatuses.done
    || row.status === subagentRunStatuses.failed
    || row.status === subagentRunStatuses.cancelled
    || row.status === subagentRunStatuses.timedOut;
}

function includeAncestors(
  row: SubagentRunRow,
  rowsById: ReadonlyMap<string, SubagentRunRow>,
  includedIds: Set<string>,
): void {
  let current: SubagentRunRow | undefined = row;
  const visited = new Set<string>();
  while (current && !visited.has(current.id) && !includedIds.has(current.id)) {
    visited.add(current.id);
    includedIds.add(current.id);
    current = current.parentId ? rowsById.get(current.parentId) : undefined;
  }
}
