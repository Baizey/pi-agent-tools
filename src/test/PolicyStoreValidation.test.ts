import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CodeExecPolicyDao,
  CodeExecPolicyLogic,
  CodeExecPolicyLogicStore,
  FsAccessType,
  PathPolicyDao,
  PathPolicyLogic,
  PathPolicyLogicStore,
  PolicyLifetime,
  PolicyStatus,
  ShellPolicyDao,
  ShellPolicyLogic,
  ShellPolicyLogicStore,
  SqliteDatabase,
  WebAccessType,
  WebPolicyDao,
  WebPolicyLogic,
  WebPolicyLogicStore,
} from "../index";
import {tempDir, test} from "./TestHarness";

function tempFile(name: string): string {
  return path.join(tempDir("pi-agent-policy-store-"), name);
}

type PolicyDaos = {
  path: PathPolicyDao;
  shell: ShellPolicyDao;
  code: CodeExecPolicyDao;
  web: WebPolicyDao;
};

function withPolicyDaos(fn: (daos: PolicyDaos) => void) {
  const dir = tempDir("pi-policy-dao-");
  const db = SqliteDatabase.test(false, path.join(dir, "agent.sqlite"));
  try {
    fn({
      path: new PathPolicyDao(db).initializeSchema(),
      shell: new ShellPolicyDao(db).initializeSchema(),
      code: new CodeExecPolicyDao(db).initializeSchema(),
      web: new WebPolicyDao(db).initializeSchema(),
    });
  } finally {
    db.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test("path policy store ignores malformed legacy JSON instead of throwing and deletes it", () => withPolicyDaos((daos) => {
  const file = tempFile("path-policy.json");
  fs.writeFileSync(file, "{not json", "utf8");
  const logic = new PathPolicyLogic({standardizePath: (input) => input});

  assert.doesNotThrow(() => new PathPolicyLogicStore(daos.path, file).loadInto(logic));
  assert.deepEqual(logic.policiesSnapshot(), []);
  assert.equal(fs.existsSync(file), false);
}));

test("path policy store filters invalid legacy policy entries", () => withPolicyDaos((daos) => {
  const file = tempFile("path-policy.json");
  fs.writeFileSync(file, JSON.stringify({
    policies: [
      {path: "", info: {}},
      {path: "allowed", info: {[FsAccessType.READ]: {accessType: FsAccessType.READ, status: PolicyStatus.ALLOWED, lifetime: PolicyLifetime.FOREVER, reason: "ok"}}},
      {path: "bad", info: {[FsAccessType.READ]: {accessType: FsAccessType.READ, status: "MAYBE", lifetime: PolicyLifetime.FOREVER, reason: "bad"}}},
    ],
  }), "utf8");
  const logic = new PathPolicyLogic({standardizePath: (input) => input});

  new PathPolicyLogicStore(daos.path, file).loadInto(logic);

  assert.equal(logic.policiesSnapshot().length, 1);
  assert.equal(fs.existsSync(file), false);
}));

test("shell policy store ignores malformed legacy JSON instead of throwing and deletes it", () => withPolicyDaos((daos) => {
  const file = tempFile("shell-policy.json");
  fs.writeFileSync(file, "{not json", "utf8");
  const logic = new ShellPolicyLogic();

  assert.doesNotThrow(() => new ShellPolicyLogicStore(daos.shell, file).loadInto(logic));
  assert.deepEqual(logic.policiesSnapshot(), []);
  assert.equal(fs.existsSync(file), false);
}));

test("code execution policy store ignores malformed legacy JSON instead of throwing and deletes it", () => withPolicyDaos((daos) => {
  const file = tempFile("code-exec-policy.json");
  fs.writeFileSync(file, "{not json", "utf8");
  const logic = new CodeExecPolicyLogic();

  assert.doesNotThrow(() => new CodeExecPolicyLogicStore(daos.code, file).loadInto(logic));
  assert.deepEqual(logic.policiesSnapshot(), []);
  assert.equal(fs.existsSync(file), false);
}));

test("web policy store ignores malformed legacy JSON instead of throwing and deletes it", () => withPolicyDaos((daos) => {
  const file = tempFile("web-policy.json");
  fs.writeFileSync(file, "{not json", "utf8");
  const logic = new WebPolicyLogic();

  assert.doesNotThrow(() => new WebPolicyLogicStore(daos.web, file).loadInto(logic));
  assert.deepEqual(logic.policiesSnapshot(), []);
  assert.equal(fs.existsSync(file), false);
}));

test("path policy store roundtrips forever policies through sqlite", () => withPolicyDaos((daos) => {
  const store = new PathPolicyLogicStore(daos.path);
  const saved = new PathPolicyLogic({standardizePath: (input) => input});
  saved.addPolicies([{
    path: "/repo",
    info: {[FsAccessType.READ]: PathPolicyLogic.createStatus(FsAccessType.READ, PolicyLifetime.FOREVER, PolicyStatus.ALLOWED, "ok")},
  }]);

  store.save(saved);

  const loaded = new PathPolicyLogic({standardizePath: (input) => input});
  store.loadInto(loaded);
  assert.equal(loaded.evaluate("/repo/file.ts", FsAccessType.READ)?.matchedStatus, PolicyStatus.ALLOWED);
  assert.equal(loaded.evaluate("/repo/file.ts", FsAccessType.WRITE, false), null);
}));

test("shell policy store roundtrips commands and flags through sqlite", () => withPolicyDaos((daos) => {
  const store = new ShellPolicyLogicStore(daos.shell);
  const saved = new ShellPolicyLogic();
  saved.addPolicies([
    ShellPolicyLogic.createPolicy(
      ["git", "status"],
      PolicyStatus.ALLOWED,
      PolicyLifetime.FOREVER,
      "ok",
      [ShellPolicyLogic.createFlagStatus("--short", PolicyStatus.ALLOWED, PolicyLifetime.FOREVER, "flag ok")],
    ),
  ]);

  store.save(saved);

  const loaded = new ShellPolicyLogic();
  store.loadInto(loaded);
  assert.equal(loaded.evaluate("git status --short")?.allowed, true);
  assert.equal(loaded.evaluate("git status --porcelain", false), null);
}));

test("code execution policy store roundtrips forever policies through sqlite", () => withPolicyDaos((daos) => {
  const store = new CodeExecPolicyLogicStore(daos.code);
  const saved = new CodeExecPolicyLogic();
  saved.addPolicies([
    CodeExecPolicyLogic.createPolicy("JavaScript", "inline", PolicyStatus.DENIED, PolicyLifetime.FOREVER, "no"),
  ]);

  store.save(saved);

  const loaded = new CodeExecPolicyLogic();
  store.loadInto(loaded);
  assert.equal(loaded.evaluate("javascript", "inline")?.matchedStatus, PolicyStatus.DENIED);
  assert.equal(loaded.evaluate("javascript", "file", false), null);
}));

test("web policy store roundtrips forever policies through sqlite", () => withPolicyDaos((daos) => {
  const store = new WebPolicyLogicStore(daos.web);
  const saved = new WebPolicyLogic();
  saved.addPolicies([
    WebPolicyLogic.createPolicy("www.Example.com", "/docs/", WebAccessType.READ, PolicyLifetime.FOREVER, PolicyStatus.ALLOWED, "ok"),
  ]);

  store.save(saved);

  const loaded = new WebPolicyLogic();
  store.loadInto(loaded);
  const result = loaded.evaluate("https://example.com/docs/page", WebAccessType.READ);
  assert.equal(result?.matchedStatus, PolicyStatus.ALLOWED);
  assert.equal(result?.matchedHost, "example.com");
  assert.equal(result?.matchedPath, "/docs");
}));

test("legacy path JSON imports into sqlite and is deleted", () => withPolicyDaos((daos) => {
  const file = tempFile("path-policy.json");
  fs.writeFileSync(file, JSON.stringify({
    policies: [{
      path: "/repo",
      info: {[FsAccessType.DELETE]: PathPolicyLogic.createStatus(FsAccessType.DELETE, PolicyLifetime.FOREVER, PolicyStatus.DENIED, "no")},
    }],
  }), "utf8");

  const first = new PathPolicyLogic({standardizePath: (input) => input});
  new PathPolicyLogicStore(daos.path, file).loadInto(first);
  assert.equal(fs.existsSync(file), false);

  const second = new PathPolicyLogic({standardizePath: (input) => input});
  new PathPolicyLogicStore(daos.path).loadInto(second);
  assert.equal(second.evaluate("/repo/file.ts", FsAccessType.DELETE)?.matchedStatus, PolicyStatus.DENIED);
}));

test("legacy shell JSON imports into sqlite and is deleted", () => withPolicyDaos((daos) => {
  const file = tempFile("shell-policy.json");
  fs.writeFileSync(file, JSON.stringify({
    policies: [ShellPolicyLogic.createPolicy(["git", "status"], PolicyStatus.ALLOWED, PolicyLifetime.FOREVER, "ok")],
  }), "utf8");

  const first = new ShellPolicyLogic();
  new ShellPolicyLogicStore(daos.shell, file).loadInto(first);
  assert.equal(fs.existsSync(file), false);

  const second = new ShellPolicyLogic();
  new ShellPolicyLogicStore(daos.shell).loadInto(second);
  assert.equal(second.evaluate("git status")?.allowed, true);
}));

test("legacy code execution JSON imports into sqlite and is deleted", () => withPolicyDaos((daos) => {
  const file = tempFile("code-exec-policy.json");
  fs.writeFileSync(file, JSON.stringify({
    policies: [CodeExecPolicyLogic.createPolicy("python", "file", PolicyStatus.ALLOWED, PolicyLifetime.FOREVER, "ok")],
  }), "utf8");

  const first = new CodeExecPolicyLogic();
  new CodeExecPolicyLogicStore(daos.code, file).loadInto(first);
  assert.equal(fs.existsSync(file), false);

  const second = new CodeExecPolicyLogic();
  new CodeExecPolicyLogicStore(daos.code).loadInto(second);
  assert.equal(second.evaluate("python", "file")?.matchedStatus, PolicyStatus.ALLOWED);
}));

test("legacy web JSON imports into sqlite and is deleted", () => withPolicyDaos((daos) => {
  const file = tempFile("web-policy.json");
  fs.writeFileSync(file, JSON.stringify({
    policies: [WebPolicyLogic.createPolicy("example.com", "/", WebAccessType.SEARCH, PolicyLifetime.FOREVER, PolicyStatus.DENIED, "no")],
  }), "utf8");

  const first = new WebPolicyLogic();
  new WebPolicyLogicStore(daos.web, file).loadInto(first);
  assert.equal(fs.existsSync(file), false);

  const second = new WebPolicyLogic();
  new WebPolicyLogicStore(daos.web).loadInto(second);
  assert.equal(second.evaluate("https://example.com/", WebAccessType.SEARCH)?.matchedStatus, PolicyStatus.DENIED);
}));
