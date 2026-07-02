import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {test, tempDir} from "./TestHarness";
import {SqliteDatabase, SubagentDao, subagentRunStatuses} from "../storage";
import {subagentRunModes} from "../shared/subagents";
import {renderSubagentRunTree} from "../extensions/subagent/tree-ui";

function withDao(fn: (dao: SubagentDao) => void) {
  const dir = tempDir("pi-subagent-dao-");
  const db = SqliteDatabase.test(false, path.join(dir, "agent.sqlite"));
  try {
    fn(new SubagentDao(db).initializeSchema());
  } finally {
    db.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test("subagent dao stores and renders a tree using explicit parent relationships", () => withDao(dao => {
  dao.startRun({
    id: "root-session-1",
    rootId: "root-session",
    parentId: undefined,
    ordinal: 1,
    depth: 0,
    mode: subagentRunModes.async,
    task: "root task",
    profiles: [],
    tools: [],
  });
  dao.startRun({
    id: "root-session-1-1",
    rootId: "root-session",
    parentId: "root-session-1",
    ordinal: 1,
    depth: 1,
    mode: subagentRunModes.sync,
    task: "child task",
    profiles: [],
    tools: [],
  });
  dao.updateRun("root-session-1", {status: subagentRunStatuses.running, latestLine: "working"});
  dao.finishRun("root-session-1-1", subagentRunStatuses.done, {latestLine: "done"});

  const tree = renderSubagentRunTree(dao.listTree("root-session"), "root-session-1");
  assert.deepEqual(tree, [
    "Subagents",
    "└─ root-session-1 ⏳ working",
    "   └─ root-session-1-1 ✓ done",
  ]);
}));

test("subagent dao allocates child ordinals per parent", () => withDao(dao => {
  assert.equal(dao.nextOrdinal(null, "root"), 1);
  dao.startRun({
    id: "root-1",
    rootId: "root",
    ordinal: 1,
    depth: 0,
    mode: subagentRunModes.async,
    task: "first",
    profiles: [],
    tools: [],
  });
  assert.equal(dao.nextOrdinal(null, "root"), 2);
  assert.equal(dao.nextOrdinal("root-1", "root"), 1);
}));
