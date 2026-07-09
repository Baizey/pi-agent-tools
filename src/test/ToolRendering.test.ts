import assert from "node:assert/strict";
import {test} from "./TestHarness";
import {renderBlockToolCall} from "../shared/blockToolRendering";
import {
  FoldDirection,
  renderLines,
  renderToolCallInput,
  renderToolResultOutput,
  ToolRenderDefaultKeyText,
  ToolRenderKeybindingDescription,
  ToolRenderTerminalInput,
} from "../shared/toolRendering";
import {handleToolExpandInput} from "../extensions/tool-rendering-controls";
import {renderCodeExecCall} from "../extensions/tools/code-exec/rendering";
import {BoundedOutput} from "../extensions/tools/code-exec/process";
import {renderSubagentTree} from "../extensions/subagent/tree-ui";
import {SubagentRunMode} from "../shared/subagents";

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

test("block tool call renderer truncates long single-line blocks to render width", () => {
  const component = renderBlockToolCall("execute_code", [], "code", "x".repeat(1000), {expanded: true});
  const lines = component.render(80);

  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(stripAnsi(line).length <= 80, line);
  assert.ok(lines[1].endsWith("…"));
});

test("expanded block tool calls retain hard TUI row and character limits", () => {
  const block = Array.from({length: 2_500}, (_, index) => `line ${index}`).join("\n");
  const lines = renderBlockToolCall("execute_code", [], "code", block, {expanded: true}).render(120);

  assert.equal(lines.length, 2_002);
  assert.equal(lines[lines.length - 1], "    ... (501 lines omitted from display)");

  const longLine = renderBlockToolCall("execute_code", [], "code", "x".repeat(250_000), {expanded: true}).render(120);
  assert.equal(longLine[longLine.length - 1], "    [block display truncated]");
});

test("tool result renderer folds head preview", () => {
  const component = renderToolResultOutput({content: [{type: "text", text: "one\ntwo\nthree"}]}, undefined, {expanded: false}, {direction: FoldDirection.HEAD, previewLines: 2});

  assert.deepEqual(component.render(120), [
    "one",
    "two",
    `... (1 more line, ${expandHintText})`,
  ]);
});

test("tool result renderer truncates long single-line output to render width", () => {
  const component = renderToolResultOutput({content: [{type: "text", text: "x".repeat(1000)}]});
  const lines = component.render(80);

  assert.equal(lines.length, 1);
  assert.ok(stripAnsi(lines[0]).length <= 80, lines[0]);
  assert.ok(lines[0].endsWith("…"));
});

test("tool result renderer splits bare carriage returns before rendering", () => {
  const component = renderToolResultOutput({content: [{type: "text", text: "one\rtwo\nthree"}]});

  assert.deepEqual(component.render(120), ["one", "two", "three"]);
});

test("tool result renderer folds tail preview", () => {
  const component = renderToolResultOutput({content: [{type: "text", text: "one\ntwo\nthree"}]}, undefined, {expanded: false}, {direction: FoldDirection.TAIL, previewLines: 2});

  assert.deepEqual(component.render(120), [
    `... (1 earlier line, ${expandHintText})`,
    "two",
    "three",
  ]);
});

test("expanded tool results retain a hard TUI row limit", () => {
  const output = Array.from({length: 2_500}, (_, index) => `line ${index}`).join("\n");
  const component = renderToolResultOutput({content: [{type: "text", text: output}]}, undefined, {expanded: true}, {direction: FoldDirection.TAIL});
  const lines = component.render(120);

  assert.equal(lines.length, 2_000);
  assert.equal(lines[0], "... (501 lines omitted from display)");
  assert.equal(lines[lines.length - 1], "line 2499");
});

test("renderLines normalizes control characters and truncates widget-style lines", () => {
  const lines = renderLines(["a\t".repeat(200), "abc\rdef", "x".repeat(200)]).render(20);

  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(stripAnsi(line).length <= 20, line);
    assert.doesNotMatch(line, /[\t\r\n\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f-\x9f]/);
  }
});

test("renderLines strips non-SGR terminal escape sequences", () => {
  const cursorMove = "\x1b[1000Cx";
  const hyperlink = "\x1b]8;;https://example.com\x07link\x1b]8;;\x07";

  assert.deepEqual(renderLines([cursorMove, hyperlink]).render(20), ["x", "link"]);
});

test("renderLines accounts for wide Unicode display width", () => {
  const cjk = "\u{20000}";

  assert.equal(renderLines([cjk.repeat(4)]).render(6)[0], `${cjk}${cjk}…`);
  assert.equal(renderLines(["\uD7B0".repeat(3)]).render(4)[0], "\uD7B0…");
  assert.equal(renderLines(["⏳".repeat(3)]).render(4)[0], "⏳…");
});

test("renderLines rejects invalid and sub-column widths safely", () => {
  const component = renderLines(["too long"]);

  assert.deepEqual(component.render(Number.NaN), [""]);
  assert.deepEqual(component.render(Number.NEGATIVE_INFINITY), [""]);
  assert.deepEqual(component.render(0.5), [""]);
});

test("code call rendering applies display-width limits to inline code", () => {
  const wide = "\u{20000}";
  const component = renderCodeExecCall({language: "javascript", code: wide.repeat(20)}, undefined, {expanded: true});

  assert.equal(component.render(10)[4], `    ${wide}${wide}…`);
});

test("code process output stays bounded across chunks", () => {
  const output = new BoundedOutput(5);
  output.append("12");
  output.append("345");
  assert.equal(output.value(), "12345");

  output.append("67");
  assert.equal(output.value(), "12345\n[truncated]");
});

test("subagent tree widget lines apply display-width limits", () => {
  const wide = "\u{20000}";
  const tree = renderSubagentTree({
    id: "root",
    rootId: "root",
    depth: 0,
    mode: SubagentRunMode.async,
    task: wide.repeat(40),
    role: "reviewer",
    toolkits: [],
    tools: [],
    status: "running",
    latestLine: "",
    startedAt: 0,
    children: [],
  }, () => undefined);

  const rendered = renderLines(tree).render(20);
  assert.equal(rendered[1], `└─ reviewer (root) …`);
});

test("subagent tree rendering bounds child resolution and rejects cycles", () => {
  const childIds = Array.from({length: 10_000}, (_, index) => `child-${index}`);
  const root = {
    id: "root",
    rootId: "root",
    depth: 0,
    mode: SubagentRunMode.async,
    task: "root",
    role: "root",
    toolkits: [],
    tools: [],
    status: "running" as const,
    latestLine: "",
    startedAt: 0,
    children: childIds,
  };
  let resolutions = 0;
  const tree = renderSubagentTree(root, (id) => {
    resolutions++;
    return {
      ...root,
      id,
      depth: 1,
      role: "child",
      children: id === "child-0" ? ["root"] : [],
    };
  });

  assert.ok(resolutions <= 200, `resolved ${resolutions} children`);
  assert.ok(tree.length <= 202, `rendered ${tree.length} lines`);
  assert.match(tree.join("\n"), /additional subagents omitted/);

  const cyclicChild = {...root, id: "child", depth: 1, role: "child", children: ["root"]};
  const cyclicRoot = {...root, children: ["child"]};
  const cyclicTree = renderSubagentTree(cyclicRoot, id => id === "root" ? cyclicRoot : cyclicChild);
  assert.equal(cyclicTree.filter(line => line.includes("root (root)")).length, 1);
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
