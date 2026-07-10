import fs from "node:fs";
import path from "node:path";
import {resolvePhysicalPath, stripTrailingPathSeparators} from "../shared/paths";
import {tempDir} from "./TestHarness";

test("trailing separator stripping preserves POSIX roots", () => {
  expect(stripTrailingPathSeparators("/", path.posix)).toBe("/");
  expect(stripTrailingPathSeparators("///", path.posix)).toBe("/");
  expect(stripTrailingPathSeparators("/tmp///", path.posix)).toBe("/tmp");
});

test("trailing separator stripping preserves Windows drive roots", () => {
  expect(stripTrailingPathSeparators("C:\\", path.win32)).toBe("C:\\");
  expect(stripTrailingPathSeparators("C:\\\\", path.win32)).toBe("C:\\");
  expect(stripTrailingPathSeparators("C:\\temp\\", path.win32)).toBe("C:\\temp");
});

test("trailing separator stripping preserves Windows UNC roots", () => {
  expect(stripTrailingPathSeparators("\\\\server\\share\\", path.win32)).toBe("\\\\server\\share\\");
  expect(stripTrailingPathSeparators("\\\\server\\share\\folder\\", path.win32)).toBe("\\\\server\\share\\folder");
});

test("physical path resolution preserves the host filesystem root", () => {
  const root = path.parse(path.resolve(".")).root;
  expect(resolvePhysicalPath(root)).toBe(stripTrailingPathSeparators(fs.realpathSync.native(root)));
});

test("physical path resolution retains nonexistent descendants below an existing ancestor", () => {
  const base = tempDir("pi-agent-paths-missing-");
  try {
    const candidate = path.join(base, "missing", "child") + path.sep;
    const expected = path.join(fs.realpathSync.native(base), "missing", "child");
    expect(resolvePhysicalPath(candidate)).toBe(expected);
  } finally {
    fs.rmSync(base, {recursive: true, force: true});
  }
});

test("physical path resolution follows a symlinked ancestor for nonexistent descendants", () => {
  const base = tempDir("pi-agent-paths-symlink-");
  try {
    const physical = path.join(base, "physical");
    const link = path.join(base, "link");
    fs.mkdirSync(physical);

    try {
      fs.symlinkSync(physical, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (isPermissionError(error)) return;
      throw error;
    }

    const candidate = path.join(link, "missing", "child");
    const expected = path.join(fs.realpathSync.native(physical), "missing", "child");
    expect(resolvePhysicalPath(candidate)).toBe(expected);
  } finally {
    fs.rmSync(base, {recursive: true, force: true});
  }
});

function isPermissionError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error.code === "EPERM" || error.code === "EACCES");
}
