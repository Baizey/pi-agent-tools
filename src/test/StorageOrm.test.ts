import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {tempDir} from "./TestHarness";
import {Orm, SqliteDatabase, column, table} from "../storage";

const widgets = table("widgets", {
  id: column.text().primaryKey(),
  name: column.text().notNull(),
  tag: column.text().nullable(),
  count: column.integer().notNull(),
});

function withDb(fn: (orm: Orm) => void) {
  const dir = tempDir("pi-orm-");
  const file = path.join(dir, "test.sqlite");
  const db = SqliteDatabase.test(false, file);
  try {
    const orm = new Orm(db).createTable(widgets);
    fn(orm);
  } finally {
    db.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test("orm inserts, upserts, queries, and updates rows", () => withDb(orm => {
  orm.insert(widgets, {id: "a", name: "Alpha", tag: "one", count: 1});
  assert.equal(orm.get(widgets, {id: "a"})?.name, "Alpha");

  orm.upsert(widgets, {id: "a", name: "Beta", tag: "two", count: 2}, ["id"]);
  assert.deepEqual(orm.get(widgets, {id: "a"})?.count, 2);

  orm.update(widgets, {id: "a"}, {count: 3});
  assert.equal(orm.get(widgets, {id: "a"})?.count, 3);
}));

test("orm where supports null values", () => withDb(orm => {
  orm.insert(widgets, {id: "a", name: "Alpha", tag: null, count: 1});
  orm.insert(widgets, {id: "b", name: "Beta", tag: "set", count: 2});

  const rows = orm.all(widgets, {tag: null});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "a");
}));

test("orm refuses accidental bulk update and invalid limits", () => withDb(orm => {
  orm.insert(widgets, {id: "a", name: "Alpha", tag: null, count: 1});

  assert.throws(() => orm.update(widgets, {}, {count: 2}), /Refusing to update all rows/);
  assert.throws(() => orm.all(widgets, {}, {limit: -1}), /Invalid sqlite limit/);
  assert.throws(() => orm.all(widgets, {}, {limit: 1.5}), /Invalid sqlite limit/);
}));
