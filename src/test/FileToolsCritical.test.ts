import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {copyPath, deletePath, makeDirectory, movePath, statPath} from "../extensions/tools/file-tools/operations";

async function tempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "pi-agent-file-tools-"));
}

test("file tools resolve relative paths against ctx cwd and mutate expected targets", async () => {
  const cwd = await tempDir();
  await fs.writeFile(path.join(cwd, "source.txt"), "hello", "utf8");

  const copy = await copyPath({from: "source.txt", to: "copy.txt"}, undefined, {cwd, hasUI: false});
  assert.equal("isError" in copy, false);
  assert.equal(await fs.readFile(path.join(cwd, "copy.txt"), "utf8"), "hello");

  const move = await movePath({from: "copy.txt", to: "moved.txt"}, undefined, {cwd, hasUI: false});
  assert.equal("isError" in move, false);
  assert.equal(await fs.readFile(path.join(cwd, "moved.txt"), "utf8"), "hello");
  await assert.rejects(() => fs.stat(path.join(cwd, "copy.txt")));

  const stat = await statPath({path: "moved.txt"}, undefined, {cwd, hasUI: false});
  assert.equal("isError" in stat, false);
  assert.equal((stat.details as {type?: unknown}).type, "file");

  const del = await deletePath({path: "moved.txt"}, undefined, {cwd, hasUI: false});
  assert.equal("isError" in del, false);
  await assert.rejects(() => fs.stat(path.join(cwd, "moved.txt")));
});

test("destructive file tools require explicit recursive or overwrite options", async () => {
  const cwd = await tempDir();
  await fs.mkdir(path.join(cwd, "dir"));
  await fs.writeFile(path.join(cwd, "dir", "payload.txt"), "payload", "utf8");
  await fs.writeFile(path.join(cwd, "from.txt"), "from", "utf8");
  await fs.writeFile(path.join(cwd, "to.txt"), "to", "utf8");

  const deleteNonRecursive = await deletePath({path: "dir"}, undefined, {cwd, hasUI: false});
  assert.equal("isError" in deleteNonRecursive && deleteNonRecursive.isError, true);
  assert.equal(await fs.readFile(path.join(cwd, "dir", "payload.txt"), "utf8"), "payload");

  const moveNoOverwrite = await movePath({from: "from.txt", to: "to.txt"}, undefined, {cwd, hasUI: false});
  assert.equal("isError" in moveNoOverwrite && moveNoOverwrite.isError, true);
  assert.equal(await fs.readFile(path.join(cwd, "from.txt"), "utf8"), "from");
  assert.equal(await fs.readFile(path.join(cwd, "to.txt"), "utf8"), "to");

  const moveOverwrite = await movePath({from: "from.txt", to: "to.txt", overwrite: true}, undefined, {cwd, hasUI: false});
  assert.equal("isError" in moveOverwrite, false);
  assert.equal(await fs.readFile(path.join(cwd, "to.txt"), "utf8"), "from");

  const deleteRecursive = await deletePath({path: "dir", recursive: true}, undefined, {cwd, hasUI: false});
  assert.equal("isError" in deleteRecursive, false);
  await assert.rejects(() => fs.stat(path.join(cwd, "dir")));
});

test("file tools honor pre-start cancellation", async () => {
  const cwd = await tempDir();
  const controller = new AbortController();
  controller.abort();

  const mkdir = await makeDirectory({path: "blocked"}, controller.signal, {cwd, hasUI: false});
  assert.equal("isError" in mkdir && mkdir.isError, true);
  await assert.rejects(() => fs.stat(path.join(cwd, "blocked")));
});
