import {SubagentNode, subagentNodeStatuses} from "./types";

const statusIcons: Record<SubagentNode["status"], string> = {
  [subagentNodeStatuses.starting]: "…",
  [subagentNodeStatuses.running]: "⏳",
  [subagentNodeStatuses.done]: "✓",
  [subagentNodeStatuses.failed]: "✗",
  [subagentNodeStatuses.cancelled]: "⏹",
  [subagentNodeStatuses.timedOut]: "⌛",
};

export function renderSubagentTree(root: SubagentNode, nodeFor: (id: string) => SubagentNode | undefined): string[] {
  return ["Subagents", ...renderNode(root, nodeFor, "", true)];
}

function renderNode(
  node: SubagentNode,
  nodeFor: (id: string) => SubagentNode | undefined,
  prefix: string,
  isLast: boolean,
): string[] {
  const connector = node.depth === 0 ? "└─ " : isLast ? "└─ " : "├─ ";
  const line = `${prefix}${connector}${node.id} ${statusIcons[node.status]} ${shorten(node.latestLine || node.task)}`;
  const childPrefix = `${prefix}${node.depth === 0 ? "   " : isLast ? "   " : "│  "}`;
  const children = node.children.map(nodeFor).filter((child): child is SubagentNode => Boolean(child));
  return [
    line,
    ...children.flatMap((child, index) => renderNode(child, nodeFor, childPrefix, index === children.length - 1)),
  ];
}

function shorten(value: string, maxLength = 80): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}
