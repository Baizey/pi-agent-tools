import assert from "node:assert/strict";
import {test} from "./TestHarness";
import {renderBlockToolCall} from "../shared/blockToolRendering";
import {renderToolCallInput} from "../shared/toolRendering";

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

test("tool call renderer truncates long array argument lines to render width", () => {
  const component = renderToolCallInput("subagent_spawn", {
    contextPaths: [
      "C:/repos/mudlr-lsp-intellij-plugin/src/main/kotlin/com/festinafinance/mudlr/inspections",
      "C:/repos/mudlr-lsp-intellij-plugin/src/main/kotlin/com/festinafinance/mudlr/very/deep/path/that/keeps/going",
    ],
  });

  const lines = component.render(80);

  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(stripAnsi(line).length <= 80, line);
});

test("tool call renderer preserves ANSI styling while truncating visible width", () => {
  const theme = {
    fg: (_color: string, text: string) => `\x1b[2m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  };
  const component = renderToolCallInput("subagent_spawn", {task: "x".repeat(100)}, theme);

  const lines = component.render(40);

  for (const line of lines) assert.ok(stripAnsi(line).length <= 40, line);
  assert.match(lines[1], /\x1b\[/);
});

test("block tool call renderer respects folded context", () => {
  const component = renderBlockToolCall("bash", ["  timeout: 30"], "command", "first\nsecond\nthird", {expanded: false});

  assert.deepEqual(component.render(120), [
    "bash",
    "  timeout: 30",
    "  command: first … (2 more lines)",
  ]);
});

test("block tool call renderer shows full block when expanded", () => {
  const component = renderBlockToolCall("bash", [], "command", "first\nsecond", {expanded: true});

  assert.deepEqual(component.render(120), [
    "bash",
    "  command:",
    "    first",
    "    second",
  ]);
});
