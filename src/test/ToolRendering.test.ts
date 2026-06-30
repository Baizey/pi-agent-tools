import assert from "node:assert/strict";
import {test} from "./TestHarness";
import {renderBlockToolCall} from "../shared/blockToolRendering";
import {
  FoldDirection,
  renderToolCallInput,
  renderToolResultOutput,
  ToolRenderDefaultKeyText,
  ToolRenderKeybindingDescription,
  ToolRenderTerminalInput,
} from "../shared/toolRendering";
import {handleToolExpandInput} from "../extensions/tool-rendering-controls";

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const expandHintText = `${ToolRenderDefaultKeyText.TOOLS_EXPAND} ${ToolRenderKeybindingDescription.EXPAND}`;

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

test("block tool call renderer shows folded head preview", () => {
  const component = renderBlockToolCall("bash", ["  timeout: 30"], "command", "first\nsecond\nthird", {expanded: false}, {direction: FoldDirection.HEAD, previewLines: 2});

  assert.deepEqual(component.render(120), [
    "bash",
    "  timeout: 30",
    "  command:",
    "    first",
    "    second",
    `    ... (1 more line, ${expandHintText})`,
  ]);
});


test("block tool call renderer shows folded tail preview", () => {
  const component = renderBlockToolCall("execute_code", [], "code", "first\nsecond\nthird", {expanded: false}, {direction: FoldDirection.TAIL, previewLines: 2});

  assert.deepEqual(component.render(120), [
    "execute_code",
    "  code:",
    `    ... (1 earlier line, ${expandHintText})`,
    "    second",
    "    third",
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

test("tool result renderer folds head preview", () => {
  const component = renderToolResultOutput({content: [{type: "text", text: "one\ntwo\nthree"}]}, undefined, {expanded: false}, {direction: FoldDirection.HEAD, previewLines: 2});

  assert.deepEqual(component.render(120), [
    "one",
    "two",
    `... (1 more line, ${expandHintText})`,
  ]);
});

test("tool result renderer folds tail preview", () => {
  const component = renderToolResultOutput({content: [{type: "text", text: "one\ntwo\nthree"}]}, undefined, {expanded: false}, {direction: FoldDirection.TAIL, previewLines: 2});

  assert.deepEqual(component.render(120), [
    `... (1 earlier line, ${expandHintText})`,
    "two",
    "three",
  ]);
});

test("tool rendering control toggles global tool expansion on expand key", () => {
  let expanded = false;
  const result = handleToolExpandInput(ToolRenderTerminalInput.TOOLS_EXPAND, {
    ui: {
      getToolsExpanded: () => expanded,
      setToolsExpanded: (value: boolean) => { expanded = value; },
    } as never,
  });

  assert.deepEqual(result, {consume: true});
  assert.equal(expanded, true);
});
