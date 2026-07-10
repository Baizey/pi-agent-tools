import assert from "node:assert/strict";
import {renderSubagentRunTree, SubagentTreeFilter} from "../extensions/subagent/tree-ui";
import {subagentRunStatuses} from "../storage";
import type {SubagentRunRow} from "../storage";
import {SubagentRunMode} from "../shared/subagents";

test("subagent database rendering keeps matching ancestors", () => {
  const root = row("root", null, 1, subagentRunStatuses.running);
  const child = row("child", "root", 1, subagentRunStatuses.done);

  const lines = renderSubagentRunTree([root, child], "root", SubagentTreeFilter.done);
  assert.match(lines.join("\n"), /reviewer \(root\)/);
  assert.match(lines.join("\n"), /reviewer \(child\)/);
});

test("subagent database rendering has one total forest budget", () => {
  const rows = Array.from({length: 300}, (_, index) => row(`root-${index}`, null, index));
  const lines = renderSubagentRunTree(rows, "session");

  assert.ok(lines.length <= 201, `rendered ${lines.length} lines`);
  assert.match(lines[lines.length - 1], /additional subagents omitted/);
});

test("subagent database rendering treats missing parents as roots", () => {
  const orphan = row("orphan", "missing", 1);
  const lines = renderSubagentRunTree([orphan], "session");
  assert.match(lines.join("\n"), /reviewer \(orphan\)/);
});

test("subagent filtering terminates on cyclic persisted parents", () => {
  const first = row("first", "second", 1, subagentRunStatuses.done);
  const second = row("second", "first", 1, subagentRunStatuses.done);
  assert.deepEqual(renderSubagentRunTree([first, second], "session", SubagentTreeFilter.done), []);
});

function row(
  id: string,
  parentId: string | null,
  ordinal: number,
  status: SubagentRunRow["status"] = subagentRunStatuses.running,
): SubagentRunRow {
  return {
    id,
    rootId: "session",
    parentId,
    ordinal,
    depth: parentId ? 1 : 0,
    mode: SubagentRunMode.async,
    task: "task",
    role: "reviewer",
    persona: null,
    profiles: [],
    tools: [],
    status,
    latestLine: "",
    startedAt: new Date(0),
    updatedAt: new Date(0),
    finishedAt: null,
    exitCode: null,
    timedOut: null,
    error: null,
  };
}
