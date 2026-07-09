import {subagentNodeStatuses} from "./types";
import type {SubagentNode} from "./types";

const statusIcons: Record<SubagentNode["status"], string> = {
  [subagentNodeStatuses.starting]: "…",
  [subagentNodeStatuses.running]: "⏳",
  [subagentNodeStatuses.done]: "✓",
  [subagentNodeStatuses.failed]: "✗",
  [subagentNodeStatuses.cancelled]: "⏹",
  [subagentNodeStatuses.timedOut]: "⌛",
};

export type SubagentTreeRenderLimits = {
  /** Total lines, including the heading and omission notices. */
  maxLines: number;
  maxDepth: number;
  /** Total calls to the node resolver. */
  maxLookups: number;
};

export const defaultSubagentTreeRenderLimits: SubagentTreeRenderLimits = {
  maxLines: 201,
  maxDepth: 20,
  maxLookups: 800,
};

type PendingNode = {
  kind: "node";
  node: SubagentNode;
  prefix: string;
  isLast: boolean;
  depth: number;
  ancestors: ReadonlySet<string>;
};

type PendingLine = {
  kind: "line";
  text: string;
};

type PendingItem = PendingNode | PendingLine;

type ResolvedChildren = {
  nodes: SubagentNode[];
  omitted: boolean;
};

export function renderSubagentTree(
  root: SubagentNode,
  nodeFor: (id: string) => SubagentNode | undefined,
  limits: SubagentTreeRenderLimits = defaultSubagentTreeRenderLimits,
): string[] {
  return new SubagentTreeRenderer(nodeFor, limits).render(root);
}

class SubagentTreeRenderer {
  private readonly lines = ["Subagents"];
  private readonly pending: PendingItem[] = [];
  private lookups = 0;

  constructor(
    private readonly nodeFor: (id: string) => SubagentNode | undefined,
    private readonly limits: SubagentTreeRenderLimits,
  ) {}

  render(root: SubagentNode): string[] {
    this.pending.push({
      kind: "node",
      node: root,
      prefix: "",
      isLast: true,
      depth: 0,
      ancestors: new Set<string>(),
    });

    while (this.pending.length > 0 && this.lines.length < this.limits.maxLines) {
      const item = this.pending.pop()!;
      if (item.kind === "line") this.lines.push(item.text);
      else this.renderNode(item);
    }

    return this.lines;
  }

  private renderNode(current: PendingNode): void {
    this.lines.push(formatNodeLine(current));
    if (current.node.children.length === 0) return;
    if (this.remainingCapacity() === 0) {
      this.lines[this.lines.length - 1] = formatNodeLine(current, "… descendants omitted");
      return;
    }

    const childPrefix = treeChildPrefix(current);
    if (current.depth >= this.limits.maxDepth) {
      this.scheduleNotice(`${childPrefix}└─ … (deeper subagents omitted)`);
      return;
    }

    const resolved = this.resolveChildren(current);
    this.scheduleChildren(current, childPrefix, resolved);
  }

  private resolveChildren(current: PendingNode): ResolvedChildren {
    const capacity = this.remainingCapacity();
    const nodes: SubagentNode[] = [];
    const seenChildIds = new Set<string>();
    let childIndex = 0;

    while (
      childIndex < current.node.children.length
      && nodes.length < capacity
      && this.lookups < this.limits.maxLookups
    ) {
      const childId = current.node.children[childIndex++];
      if (seenChildIds.has(childId)) continue;
      seenChildIds.add(childId);

      const child = this.nodeFor(childId);
      this.lookups++;
      if (child && child.id !== current.node.id && !current.ancestors.has(child.id)) nodes.push(child);
    }

    return {
      nodes,
      omitted: childIndex < current.node.children.length,
    };
  }

  private scheduleChildren(parent: PendingNode, prefix: string, resolved: ResolvedChildren): void {
    const children = [...resolved.nodes];
    if (resolved.omitted && children.length >= this.remainingCapacity()) children.pop();
    if (resolved.omitted) this.scheduleNotice(`${prefix}└─ … (additional subagents omitted)`);
    if (children.length === 0) return;

    const ancestors = new Set(parent.ancestors);
    ancestors.add(parent.node.id);
    for (let index = children.length - 1; index >= 0; index--) {
      this.pending.push({
        kind: "node",
        node: children[index],
        prefix,
        isLast: index === children.length - 1,
        depth: parent.depth + 1,
        ancestors,
      });
    }
  }

  private scheduleNotice(text: string): void {
    if (this.remainingCapacity() > 0) this.pending.push({kind: "line", text});
  }

  private remainingCapacity(): number {
    return Math.max(0, this.limits.maxLines - this.lines.length - this.pending.length);
  }
}

function formatNodeLine(current: PendingNode, statusText?: string): string {
  const connector = current.depth === 0 ? "└─ " : current.isLast ? "└─ " : "├─ ";
  const label = current.node.role ? `${current.node.role} (${current.node.id})` : current.node.id;
  const status = statusIcons[current.node.status];
  const latest = statusText ?? summarizeStatus(current.node.latestLine || current.node.task);
  return `${current.prefix}${connector}${label} ${status} ${latest}`;
}

function treeChildPrefix(current: PendingNode): string {
  return `${current.prefix}${current.depth === 0 || current.isLast ? "   " : "│  "}`;
}

function summarizeStatus(value: string, maxLength = 80): string {
  const scanLimit = maxLength * 4;
  const bounded = value.length > scanLimit ? value.slice(0, scanLimit) : value;
  const normalized = bounded.replace(/\s+/g, " ").trim();
  const truncated = normalized.length > maxLength || bounded.length < value.length;
  return truncated ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}
