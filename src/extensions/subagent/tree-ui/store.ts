import {renderSubagentTree} from "./render";
import {StartSubagentNodeInput, SubagentNode, subagentNodeStatuses, SubagentNodeStatus, SubagentNodeUpdate} from "./types";

const nodes = new Map<string, SubagentNode>();
const rootCounters = new Map<string, number>();
let nextRootId = 1;

export function startSubagentNode(input: StartSubagentNodeInput): SubagentNode {
  const parent = input.parentId ? nodes.get(input.parentId) : undefined;
  const id = input.id ?? nextChildId(input.parentId);
  const node: SubagentNode = {
    id,
    rootId: input.rootId ?? parent?.rootId ?? id,
    parentId: input.parentId,
    depth: input.depth ?? (parent ? parent.depth + 1 : 0),
    mode: input.mode,
    task: input.task,
    profiles: input.profiles,
    tools: input.tools,
    status: subagentNodeStatuses.starting,
    latestLine: input.task,
    startedAt: Date.now(),
    children: [],
  };

  nodes.set(node.id, node);
  if (node.parentId) {
    const storedParent = nodes.get(node.parentId);
    if (storedParent && !storedParent.children.includes(node.id)) storedParent.children.push(node.id);
  }
  return node;
}

export function updateSubagentNode(id: string, update: SubagentNodeUpdate): SubagentNode | undefined {
  const node = nodes.get(id);
  if (!node) return undefined;
  Object.assign(node, update);
  return node;
}

export function finishSubagentNode(id: string, status: SubagentNodeStatus, latestLine?: string): SubagentNode | undefined {
  return updateSubagentNode(id, {status, latestLine: latestLine ?? nodes.get(id)?.latestLine, finishedAt: Date.now()});
}

export function getSubagentNode(id: string): SubagentNode | undefined {
  return nodes.get(id);
}

export function renderSubagentTreeFor(rootId: string): string[] {
  const root = nodes.get(rootId);
  if (!root) return [];
  return renderSubagentTree(root, (id) => nodes.get(id));
}

export function nextRootSubagentId(): string {
  return `subagent-${nextRootId++}`;
}

export function nextChildId(parentId: string | undefined): string {
  if (!parentId) return nextRootSubagentId();
  const next = (rootCounters.get(parentId) ?? 0) + 1;
  rootCounters.set(parentId, next);
  return `${parentId}.${next}`;
}
