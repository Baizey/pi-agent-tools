import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {test, tempDir} from "./TestHarness";
import type {PiExtensionApi} from "../index";
import {agentEnv, registerSubagentTool, SqliteDatabase, SubagentPersonaDao, toolNames} from "../index";
import {SubagentPersonaSource, subagentRunModes, subagentToolkitNames} from "../shared/subagents";
import {
  areSubagentToolkitsAvailable,
  buildSubagentRequestFromPersona,
  listAvailableSubagentPersonas,
  registerAvailablePersonasTool,
} from "../extensions/subagent/personas";
import {buildAgentToolsPromptGuidance} from "../extensions/prompt-guidance";

function withDb(fn: (db: SqliteDatabase, dao: SubagentPersonaDao) => void): void {
  const dir = tempDir("pi-available-personas-");
  const db = SqliteDatabase.test(false, path.join(dir, "agent.sqlite"));
  try {
    fn(db, new SubagentPersonaDao(db).initializeSchema());
  } finally {
    db.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

function withToolkitCeiling(value: string | undefined, fn: () => void): void {
  const previous = process.env[agentEnv.subagentToolkitCeiling];
  try {
    if (value === undefined) delete process.env[agentEnv.subagentToolkitCeiling];
    else process.env[agentEnv.subagentToolkitCeiling] = value;
    fn();
  } finally {
    if (previous === undefined) delete process.env[agentEnv.subagentToolkitCeiling];
    else process.env[agentEnv.subagentToolkitCeiling] = previous;
  }
}

test("available_personas seeds builtins and returns summary fields only", () => withDb(db => {
  const personas = listAvailableSubagentPersonas(db, null);
  const reviewer = personas.find(persona => persona.name === "reviewer");

  assert.ok(reviewer);
  assert.equal(reviewer.role, "code reviewer");
  assert.equal(reviewer.mode, subagentRunModes.async);
  assert.equal(reviewer.model, "reasoning_low");
  assert.deepEqual(reviewer.toolkits, [subagentToolkitNames.ioRead]);
  assert.equal(reviewer.source, SubagentPersonaSource.builtin);
  assert.deepEqual(Object.keys(reviewer).sort(), [
    "description",
    "mode",
    "model",
    "name",
    "role",
    "source",
    "toolkits",
  ].sort());
}));

test("available_personas reads PI_AGENT_SUBAGENT_TOOLKIT_CEILING by default", () => withDb(db => {
  withToolkitCeiling(subagentToolkitNames.webRead, () => {
    assert.deepEqual(listAvailableSubagentPersonas(db).map(persona => persona.name), ["researcher", "rubber-duck"]);
  });
}));

test("available_personas filters by toolkit ceiling all-or-nothing", () => withDb((db, dao) => {
  dao.upsertPersona({
    name: "repo-writer",
    role: "repository writer",
    description: "Requires both read and write repository access.",
    mode: subagentRunModes.async,
    model: "text_high",
    toolkits: [subagentToolkitNames.ioRead, subagentToolkitNames.ioWrite],
    systemPrompt: "Read and edit repository files.",
    source: SubagentPersonaSource.user,
    enabled: true,
  });
  dao.upsertPersona({
    name: "disabled-duck",
    role: "disabled duck",
    description: "Should not be returned even though it needs no tools.",
    mode: subagentRunModes.conversation,
    model: "reasoning_low",
    toolkits: [],
    systemPrompt: "Do not appear.",
    source: SubagentPersonaSource.user,
    enabled: false,
  });

  const personas = listAvailableSubagentPersonas(db, [subagentToolkitNames.ioRead]);
  const names = personas.map(persona => persona.name);

  assert.deepEqual(names, ["planner", "reviewer", "rubber-duck"]);
  assert.equal(names.includes("repo-writer"), false);
  assert.equal(names.includes("researcher"), false);
  assert.equal(names.includes("disabled-duck"), false);
  assert.equal(areSubagentToolkitsAvailable([subagentToolkitNames.ioRead, subagentToolkitNames.ioWrite], [subagentToolkitNames.ioRead]), false);
}));

test("subagent persona spawn requests are built entirely from persona config plus task", () => withDb((db) => {
  const dao = new SubagentPersonaDao(db).initializeSchema();
  dao.seedBuiltinPersonas();
  const persona = dao.getEnabledPersona("reviewer");
  assert.ok(persona);

  const request = buildSubagentRequestFromPersona({task: "review this", timeoutSeconds: 42}, persona, process.cwd());
  assert.ok(!("error" in request));
  assert.equal(request.persona, "reviewer");
  assert.equal(request.role, "code reviewer");
  assert.equal(request.mode, subagentRunModes.async);
  assert.equal(request.model, "reasoning_low");
  assert.deepEqual(request.toolkits, [subagentToolkitNames.ioRead]);
  assert.equal(request.systemPrompt, persona.systemPrompt);
  assert.equal(request.timeoutSeconds, 42);
}));

test("subagent_spawn_persona tool accepts only persona task and timeout", () => {
  const tools: Record<string, {parameters: Record<string, unknown>}> = {};
  const pi = {
    registerTool(tool: {name: string; parameters: Record<string, unknown>}) {
      tools[tool.name] = tool;
    },
  } as PiExtensionApi;

  registerSubagentTool(pi);

  const tool = tools[toolNames.subagentSpawnPersona];
  assert.ok(tool);
  assert.deepEqual(tool.parameters.required, ["persona", "task"]);
  assert.deepEqual(Object.keys(tool.parameters.properties as Record<string, unknown>).sort(), ["persona", "task", "timeoutSeconds"].sort());
});

test("available_personas tool is registered with no required parameters", () => {
  const tools: Record<string, {parameters: Record<string, unknown>}> = {};
  const pi = {
    registerTool(tool: {name: string; parameters: Record<string, unknown>}) {
      tools[tool.name] = tool;
    },
  } as PiExtensionApi;

  registerAvailablePersonasTool(pi, () => {
    throw new Error("not used");
  });

  const tool = tools[toolNames.availablePersonas];
  assert.ok(tool);
  assert.equal(tool.parameters.type, "object");
  assert.equal("required" in tool.parameters, false);
});

test("subagent prompt guidance mentions available_personas", () => {
  const guidance = buildAgentToolsPromptGuidance({selectedTools: [toolNames.availablePersonas]});

  assert.match(guidance ?? "", /available_personas/);
});
