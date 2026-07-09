import {SubagentNode, subagentNodeStatuses} from "./types";

const statusIcons: Record<SubagentNode["status"], string> = {
  [subagentNodeStatuses.starting]: "…",
  [subagentNodeStatuses.running]: "⏳",
  [subagentNodeStatuses.done]: "✓",
  [subagentNodeStatuses.failed]: "✗",
  [subagentNodeStatuses.cancelled]: "⏹",
  [subagentNodeStatuses.timedOut]: "⌛",
};

const maxRenderedNodes = 200;
const maxRenderedDepth = 20;

type PendingNode = {
  node: SubagentNode;
  prefix: string;
  isLast: boolean;
  renderDepth: number;
  ancestors: ReadonlySet<string>;
};

export function renderSubagentTree(root: SubagentNode, nodeFor: (id: string) => SubagentNode | undefined): string[] {
  const lines = ["Subagents"];
  const pending: PendingNode[] = [{
    node: root,
    prefix: "",
    isLast: true,
    renderDepth: 0,
    ancestors: new Set<string>(),
  }];
  let renderedNodes = 0;

  while (pending.length > 0 && renderedNodes < maxRenderedNodes) {
    const current = pending.pop()!;
    const {node, prefix, isLast, renderDepth, ancestors} = current;
    const connector = renderDepth === 0 ? "└─ " : isLast ? "└─ " : "├─ ";
    const label = node.role ? `${node.role} (${node.id})` : node.id;
    lines.push(`${prefix}${connector}${label} ${statusIcons[node.status]} ${shorten(node.latestLine || node.task)}`);
    renderedNodes++;

    if (node.children.length === 0) continue;

    const childPrefix = `${prefix}${renderDepth === 0 || isLast ? "   " : "│  "}`;
    if (renderDepth >= maxRenderedDepth) {
      lines.push(`${childPrefix}└─ … (deeper subagents omitted)`);
      continue;
    }

    // Account for nodes already pending so a huge child-id collection cannot
    // allocate past the global render budget.
    const childBudget = Math.max(0, maxRenderedNodes - renderedNodes - pending.length);
    const children: SubagentNode[] = [];
    const maxIdsToInspect = Math.min(node.children.length, Math.max(childBudget * 4, 1));
    let inspectedIds = 0;
    for (; inspectedIds < maxIdsToInspect && children.length < childBudget; inspectedIds++) {
      const child = nodeFor(node.children[inspectedIds]);
      if (child && child.id !== node.id && !ancestors.has(child.id)) children.push(child);
    }
    if (inspectedIds < node.children.length) {
      lines.push(`${childPrefix}└─ … (additional subagents omitted)`);
    }
    if (children.length === 0) continue;

    const childAncestors = new Set(ancestors);
    childAncestors.add(node.id);
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push({
        node: children[index],
        prefix: childPrefix,
        isLast: index === children.length - 1,
        renderDepth: renderDepth + 1,
        ancestors: childAncestors,
      });
    }
  }

  if (pending.length > 0) lines.push(`… (additional subagents omitted; display limit ${maxRenderedNodes})`);
  return lines;
}

function shorten(value: string, maxLength = 80): string {
  // Tree status should never scan an unbounded persisted result just to make an
  // 80-character preview. The extra prefix allows whitespace normalization.
  const bounded = value.length > maxLength * 4 ? value.slice(0, maxLength * 4) : value;
  const normalized = bounded.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength || bounded.length < value.length
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}
