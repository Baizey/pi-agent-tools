const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "dist");
const testFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".test.js")) testFiles.push(fullPath);
  }
}

if (fs.existsSync(root)) walk(root);
testFiles.sort();

if (testFiles.length === 0) {
  console.error("No test files found in dist.");
  process.exit(1);
}

for (const file of testFiles) {
  console.log(`\n${path.relative(root, file)}`);
  require(file);
}
