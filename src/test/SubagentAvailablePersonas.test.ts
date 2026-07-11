import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {tempDir} from "./TestHarness";
import type {PiExtensionApi} from "../index";
import {AgentEnvName, registerSubagentTool, SqliteDatabase, SubagentPersonaDao, ToolName} from "../index";
import {SubagentPersonaSource, SubagentRunMode, SubagentToolkitName} from "../shared/subagents";
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
  const previous = process.env[AgentEnvName.subagentToolkitCeiling];
  try {
    if (value === undefined) delete process.env[AgentEnvName.subagentToolkitCeiling];
    else process.env[AgentEnvName.subagentToolkitCeiling] = value;
    fn();
  } finally {
    if (previous === undefined) delete process.env[AgentEnvName.subagentToolkitCeiling];
    else process.env[AgentEnvName.subagentToolkitCeiling] = previous;
  }
}

test("available_personas seeds builtins and returns summary fields only", () => withDb(db => {
  const personas = listAvailableSubagentPersonas(db, null);
  const reviewer = personas.find(persona => persona.name === "reviewer");

  assert.ok(reviewer);
  assert.equal(reviewer.role, "code reviewer");
  assert.equal(reviewer.mode, SubagentRunMode.conversation);
  assert.equal(reviewer.model, "reasoning_high");
  assert.deepEqual(reviewer.toolkits, [SubagentToolkitName.meta, SubagentToolkitName.ioRead, SubagentToolkitName.executeBash]);
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
  withToolkitCeiling(`${SubagentToolkitName.meta},${SubagentToolkitName.webRead}`, () => {
    assert.deepEqual(Array.from(listAvailableSubagentPersonas(db), persona => persona.name), ["researcher", "rubber-duck"]);
  });
}));

test("available_personas filters by toolkit ceiling all-or-nothing", () => withDb((db, dao) => {
  dao.upsertPersona({
    name: "repo-writer",
    role: "repository writer",
    description: "Requires both read and write repository access.",
    mode: SubagentRunMode.async,
    model: "text_high",
    toolkits: [SubagentToolkitName.ioRead, SubagentToolkitName.ioWrite],
    systemPrompt: "Read and edit repository files.",
    source: SubagentPersonaSource.user,
    enabled: true,
  });
  dao.upsertPersona({
    name: "disabled-duck",
    role: "disabled duck",
    description: "Should not be returned even though it needs no tools.",
    mode: SubagentRunMode.conversation,
    model: "reasoning_low",
    toolkits: [],
    systemPrompt: "Do not appear.",
    source: SubagentPersonaSource.user,
    enabled: false,
  });

  const personas = listAvailableSubagentPersonas(db, [SubagentToolkitName.meta, SubagentToolkitName.ioRead, SubagentToolkitName.executeBash]);
  const names = Array.from(personas, persona => persona.name);

  assert.deepEqual(names, ["planner", "reviewer", "rubber-duck"]);
  assert.equal(names.includes("repo-writer"), false);
  assert.equal(names.includes("researcher"), false);
  assert.equal(names.includes("disabled-duck"), false);
  assert.equal(areSubagentToolkitsAvailable([SubagentToolkitName.ioRead, SubagentToolkitName.ioWrite], [SubagentToolkitName.ioRead]), false);
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
  assert.equal(request.mode, SubagentRunMode.conversation);
  assert.equal(request.model, "reasoning_high");
  assert.deepEqual(request.toolkits, [SubagentToolkitName.meta, SubagentToolkitName.ioRead, SubagentToolkitName.executeBash]);
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

  const tool = tools[ToolName.subagentSpawnPersona];
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

  const tool = tools[ToolName.availablePersonas];
  assert.ok(tool);
  assert.equal(tool.parameters.type, "object");
  assert.equal("required" in tool.parameters, false);
});

test("subagent prompt guidance mentions available_personas", () => {
  const guidance = buildAgentToolsPromptGuidance({selectedTools: [ToolName.availablePersonas]});

  assert.match(guidance ?? "", /available_personas/);
});
