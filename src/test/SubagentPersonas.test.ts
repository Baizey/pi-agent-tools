import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {test, tempDir} from "./TestHarness";
import {SqliteDatabase, SubagentPersonaDao, isValidSubagentPersonaName, validateSubagentPersonaName} from "../storage";
import {SubagentPersonaSource, subagentRunModes, subagentToolkitNames} from "../shared/subagents";
import {parsePersonasCommandArgs, renderSubagentPersonaDetails, renderSubagentPersonaList} from "../extensions/subagent/commands";

function withDao(fn: (dao: SubagentPersonaDao, db: SqliteDatabase) => void) {
  const dir = tempDir("pi-subagent-personas-");
  const db = SqliteDatabase.test(false, path.join(dir, "agent.sqlite"));
  try {
    fn(new SubagentPersonaDao(db).initializeSchema(), db);
  } finally {
    db.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test("subagent persona names must be lowercase ids", () => {
  assert.equal(isValidSubagentPersonaName("reviewer"), true);
  assert.equal(isValidSubagentPersonaName("rubber-duck"), true);
  assert.equal(isValidSubagentPersonaName("repo_reader"), true);
  assert.equal(isValidSubagentPersonaName("Reviewer"), false);
  assert.equal(isValidSubagentPersonaName("reviewer role"), false);
  assert.throws(() => validateSubagentPersonaName("Bad Name"), /Invalid subagent persona name/);
});

test("subagent persona schema contains only persona registry fields", () => withDao((_dao, db) => {
  const columns = db.prepare(`pragma table_info("subagent_personas")`).all() as Array<{name: string}>;
  assert.deepEqual(columns.map(column => column.name), [
    "name",
    "role",
    "description",
    "mode",
    "model",
    "toolkits",
    "systemPrompt",
    "source",
    "enabled",
    "createdAt",
    "updatedAt",
  ]);
}));

test("subagent persona dao seeds builtin personas with explicit mode and model", () => withDao(dao => {
  const seeded = dao.seedBuiltinPersonas();

  assert.equal(seeded.length, 4);
  const reviewer = dao.getEnabledPersona("reviewer");
  assert.equal(reviewer?.role, "code reviewer");
  assert.equal(reviewer?.mode, subagentRunModes.async);
  assert.equal(reviewer?.model, "reasoning_low");
  assert.deepEqual(reviewer?.toolkits, [subagentToolkitNames.ioRead]);
  assert.equal(reviewer?.source, SubagentPersonaSource.builtin);
  assert.equal(reviewer?.enabled, true);

  const duck = dao.getEnabledPersona("rubber-duck");
  assert.equal(duck?.mode, subagentRunModes.conversation);
  assert.equal(duck?.model, "reasoning_low");
  assert.deepEqual(duck?.toolkits, []);
}));

test("subagent persona dao upserts user personas and preserves createdAt", () => withDao(dao => {
  const created = dao.upsertPersona({
    name: "repo-helper",
    role: "repo helper",
    description: "Helps inspect repository state.",
    mode: subagentRunModes.async,
    model: "text_high",
    toolkits: [subagentToolkitNames.ioRead, subagentToolkitNames.ioRead],
    systemPrompt: "Inspect files and summarize.",
    source: SubagentPersonaSource.user,
    enabled: true,
  });

  const updated = dao.upsertPersona({
    ...created,
    role: "repository helper",
    enabled: false,
  });

  assert.equal(updated.role, "repository helper");
  assert.equal(updated.enabled, false);
  assert.equal(updated.createdAt.getTime(), created.createdAt.getTime());
  assert.ok(updated.updatedAt.getTime() >= created.updatedAt.getTime());
  assert.deepEqual(updated.toolkits, [subagentToolkitNames.ioRead]);
  assert.equal(dao.getEnabledPersona("repo-helper"), undefined);
}));

test("subagent persona dao reserves builtin names from user personas", () => withDao(dao => {
  dao.seedBuiltinPersonas();

  assert.throws(() => dao.upsertPersona({
    name: "reviewer",
    role: "custom reviewer",
    description: "Should not replace builtin.",
    mode: subagentRunModes.async,
    model: "text_high",
    toolkits: [],
    systemPrompt: "custom",
    source: SubagentPersonaSource.user,
    enabled: true,
  }), /reserved|builtin/);
}));

test("personas command parser supports list and show only", () => {
  assert.deepEqual(parsePersonasCommandArgs(""), {action: "list"});
  assert.deepEqual(parsePersonasCommandArgs("list"), {action: "list"});
  assert.deepEqual(parsePersonasCommandArgs("show reviewer"), {action: "show", name: "reviewer"});
  assert.equal(parsePersonasCommandArgs("show Reviewer").action, "error");
  assert.equal(parsePersonasCommandArgs("add helper").action, "error");
});

test("personas command renders concise list and full show details", () => withDao(dao => {
  dao.seedBuiltinPersonas();

  const listText = renderSubagentPersonaList(dao.listPersonas()).join("\n");
  assert.match(listText, /reviewer/);
  assert.match(listText, /reasoning_low/);
  assert.equal(listText.includes("You are a focused code reviewer."), false);

  const reviewer = dao.getPersona("reviewer");
  assert.ok(reviewer);
  const showText = renderSubagentPersonaDetails(reviewer).join("\n");
  assert.match(showText, /System prompt:/);
  assert.match(showText, /You are a focused code reviewer\./);
}));
