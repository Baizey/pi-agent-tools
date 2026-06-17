import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {test, tempDir} from "./TestHarness";
import {SessionDao, SqliteDatabase} from "../storage";
import type {ReadonlySessionManager, SessionEntry, SessionHeader} from "../pi/types";

function manager(entries: SessionEntry[], overrides: Partial<{name: string; cwd: string}> = {}): ReadonlySessionManager {
  const header: SessionHeader = {
    type: "session",
    id: "session-1",
    timestamp: "2024-01-01T00:00:00.000Z",
    cwd: overrides.cwd ?? "/repo",
  };
  return {
    getCwd: () => header.cwd,
    getSessionDir: () => "/sessions",
    getSessionId: () => header.id,
    getSessionFile: () => "/sessions/session-1.jsonl",
    getLeafId: () => entries.length ? entries[entries.length - 1].id : null,
    getLeafEntry: () => entries.length ? entries[entries.length - 1] : undefined,
    getEntry: id => entries.find(entry => entry.id === id),
    getLabel: () => undefined,
    getBranch: () => entries,
    getHeader: () => header,
    getEntries: () => entries,
    getTree: () => [],
    getSessionName: () => overrides.name,
  };
}

function withDao(fn: (dao: SessionDao) => void) {
  const dir = tempDir("pi-session-dao-");
  const file = path.join(dir, "agent.sqlite");
  const db = SqliteDatabase.test(false, file);
  try {
    const dao = new SessionDao(db).initializeSchema();
    fn(dao);
  } finally {
    db.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test("session dao syncs sessions, messages, and fts indexes", () => withDao(dao => {
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2024-01-01T00:00:01.000Z",
      message: {role: "user", content: "Find the purple database"},
    },
    {
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "2024-01-01T00:00:02.000Z",
      message: {role: "assistant", content: "The sqlite file is ready"},
    },
  ];

  dao.syncSession(manager(entries));

  assert.equal(dao.getSession("session-1")?.title, "Find the purple database");
  assert.equal(dao.messages("session-1").length, 2);
  assert.equal(dao.searchSessions("purple").length, 1);
  assert.equal(dao.searchMessages("sqlite").length, 1);
}));

test("session dao preserves manually updated title across sync", () => withDao(dao => {
  const entries: SessionEntry[] = [{
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: "2024-01-01T00:00:01.000Z",
    message: {role: "user", content: "Initial inferred title"},
  }];

  dao.syncSession(manager(entries));
  dao.updateSessionSummary("session-1", {title: "Custom title", summary: "Summary", keywords: ["custom"]});
  dao.syncSession(manager(entries));

  assert.equal(dao.getSession("session-1")?.title, "Custom title");
  assert.equal(dao.searchSessions("custom").length, 1);
}));
