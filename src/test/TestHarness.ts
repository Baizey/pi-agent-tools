import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const tempDir = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
