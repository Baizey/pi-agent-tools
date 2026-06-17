import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {tempDir} from "./TestHarness";
import {registerLocalSqlTool} from "../extensions/tools/local-sql";
import {PiExtensionApi, ToolDefinition} from "../pi/types";
import {SqliteDatabase} from "../storage";

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function withTool(fn: (tool: ToolDefinition) => Promise<void> | void) {
  const dir = tempDir("pi-local-sql-");
  const file = path.join(dir, "agent.sqlite");
  const db = SqliteDatabase.test(false, file);
  db.exec(`
    create table "items" ("id" text primary key, "name" text not null, "active" integer not null);
    insert into "items" ("id", "name", "active") values ('a', 'Alpha', 1), ('b', 'Beta', 0);
  `);
  db.close();

  let tool: ToolDefinition | undefined;
  const pi = {
    on() {},
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } satisfies PiExtensionApi;

  registerLocalSqlTool(pi, () => SqliteDatabase.test(true, file));
  assert.ok(tool);

  return Promise.resolve(fn(tool)).finally(() => {
    fs.rmSync(dir, {recursive: true, force: true});
  });
}

void (async () => {
  await test("local_sql schema returns table metadata and examples", async () => withTool(async tool => {
    const result = await tool.execute("schema", {action: "schema"});
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /items/);
    assert.match(result.content[0].text, /examples/);
  }));

  await test("local_sql runs readonly query with params, trailing semicolon, and compact details", async () => withTool(async tool => {
    const result = await tool.execute("query", {
      action: "query",
      sql: "select id, name from items where active = @active order by id;",
      params: {active: true},
      limit: 1,
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.details, {rowCount: 1, limit: 1});
    assert.match(result.content[0].text, /Alpha/);
  }));

  await test("local_sql rejects non-readonly sql", async () => withTool(async tool => {
    const result = await tool.execute("delete", {action: "query", sql: "delete from items"});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Only readonly SELECT or WITH/);
  }));

  await test("local_sql caps returned row limit", async () => withTool(async tool => {
    const result = await tool.execute("limit", {action: "query", sql: "select * from items", limit: 999});
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.details, {rowCount: 2, limit: 200});
  }));
})();
