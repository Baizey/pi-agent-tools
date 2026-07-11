import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {tempDir} from "./TestHarness";
import {SqliteDatabase, SubagentDao, SubagentRunStatus} from "../storage";
import {SubagentRunMode} from "../shared/subagents";
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
    mode: SubagentRunMode.async,
    task: "root task",
    role: "root role",
    toolkits: [],
    tools: [],
  });
  dao.startRun({
    id: "root-session-1-1",
    rootId: "root-session",
    parentId: "root-session-1",
    ordinal: 1,
    depth: 1,
    mode: SubagentRunMode.sync,
    task: "child task",
    role: "child role",
    toolkits: [],
    tools: [],
  });
  dao.updateRun("root-session-1", {status: SubagentRunStatus.running, latestLine: "working"});
  dao.finishRun("root-session-1-1", SubagentRunStatus.done, {latestLine: "done"});

  const tree = renderSubagentRunTree(dao.listTree("root-session"), "root-session-1");
  assert.deepEqual(tree, [
    "Subagents",
    "└─ root role (root-session-1) ⏳ working",
    "   └─ child role (root-session-1-1) ✓ done",
  ]);
}));

test("subagent dao allocates child ordinals per parent", () => withDao(dao => {
  assert.equal(dao.nextOrdinal(null, "root"), 1);
  dao.startRun({
    id: "root-1",
    rootId: "root",
    ordinal: 1,
    depth: 0,
    mode: SubagentRunMode.async,
    task: "first",
    role: "first role",
    toolkits: [],
    tools: [],
  });
  assert.equal(dao.nextOrdinal(null, "root"), 2);
  assert.equal(dao.nextOrdinal("root-1", "root"), 1);
}));
