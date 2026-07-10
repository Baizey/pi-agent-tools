import assert from "node:assert/strict";
import {renderSubagentTree} from "../extensions/subagent/tree-ui";
import type {SubagentNode, SubagentTreeRenderLimits} from "../extensions/subagent/tree-ui";
import {renderLines} from "../shared/toolRendering";
import {SubagentRunMode} from "../shared/subagents";

const smallLimits: SubagentTreeRenderLimits = {
  maxLines: 6,
  maxDepth: 2,
  maxLookups: 4,
};

test("subagent tree output remains safe at narrow terminal widths", () => {
  const wide = "\u{20000}";
  const root = node("root", {task: wide.repeat(40)});
  const rendered = renderLines(renderSubagentTree(root, () => undefined)).render(20);

  assert.equal(rendered[1], "└─ reviewer (root) …");
});

test("subagent tree renderer bounds node lookup and reports omissions", () => {
  const root = node("root", {children: Array.from({length: 100}, (_, index) => `child-${index}`)});
  let resolutions = 0;
  const tree = renderSubagentTree(root, id => {
    resolutions++;
    return node(id);
  }, smallLimits);

  assert.ok(resolutions <= 4, `resolved ${resolutions} children`);
  assert.match(tree.join("\n"), /additional subagents omitted/);
  assert.equal(tree.length, smallLimits.maxLines);
});

test("subagent tree renderer marks descendants displaced by pending siblings", () => {
  const root = node("root", {children: ["first", "second"]});
  const first = node("first", {children: ["grandchild"]});
  const nodes = new Map<string, SubagentNode>([
    ["first", first],
    ["second", node("second")],
    ["grandchild", node("grandchild")],
  ]);
  const lines = renderSubagentTree(root, id => nodes.get(id), {...smallLimits, maxLines: 4});
  assert.match(lines.join("\n"), /first\).*descendants omitted/);
});

test("subagent tree renderer rejects cycles and bounds depth", () => {
  const root = node("root", {children: ["child"]});
  const child = node("child", {children: ["root", "grandchild"]});
  const nodes = new Map<string, SubagentNode>([
    [root.id, root],
    [child.id, child],
    ["grandchild", node("grandchild")],
  ]);

  const cyclicTree = renderSubagentTree(root, id => nodes.get(id), smallLimits);
  assert.equal(cyclicTree.filter(line => line.includes("reviewer (root)")).length, 1);

  const shallowLimits = {...smallLimits, maxDepth: 1};
  const shallowTree = renderSubagentTree(root, id => nodes.get(id), shallowLimits);
  assert.match(shallowTree.join("\n"), /deeper subagents omitted/);
  assert.doesNotMatch(shallowTree.join("\n"), /reviewer \(grandchild\)/);
});

function node(id: string, overrides: Partial<SubagentNode> = {}): SubagentNode {
  return {
    id,
    rootId: "root",
    depth: 0,
    mode: SubagentRunMode.async,
    task: "task",
    role: "reviewer",
    toolkits: [],
    tools: [],
    status: "running",
    latestLine: "",
    startedAt: 0,
    children: [],
    ...overrides,
  };
}
