import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const test = (name: string, fn: () => void): void => {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
};

test.skip = (name: string): void => {
  console.log(`- ${name}`);
};

export const tempDir = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
