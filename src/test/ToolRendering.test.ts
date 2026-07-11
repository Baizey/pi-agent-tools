import assert from "node:assert/strict";
import {handleToolExpandInput} from "../extensions/tool-rendering-controls";
import {
  FoldDirection,
  renderToolCallInput,
  renderToolResultOutput,
  ToolRenderDefaultKeyText,
  ToolRenderKeybindingDescription,
  ToolRenderTerminalInput,
} from "../shared/toolRendering";

const expandHint = `${ToolRenderDefaultKeyText.TOOLS_EXPAND} ${ToolRenderKeybindingDescription.EXPAND}`;
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

test("tool call renderer folds arguments and preserves styling", () => {
  const theme = {
    fg: (_color: string, text: string) => `\x1b[2m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  };
  const component = renderToolCallInput("subagent_spawn", {
    task: "x".repeat(100),
    role: "reviewer",
    cwd: "/repo",
  }, theme, {expanded: false}, {previewLines: 2});
  const lines = component.render(40);

  assert.equal(lines.length, 4);
  assert.match(lines[0], /\x1b\[/);
  assert.match(lines[1], /\x1b\[/);
  assert.match(stripAnsi(lines[3]), new RegExp(expandHint.replace("+", "\\+")));
});

test("tool call renderer omits the label for one visible argument", () => {
  assert.deepEqual(
    renderToolCallInput("subagent_cancel", {jobId: "job-123"}).render(120),
    ["subagent_cancel", "  \"job-123\""],
  );
});

test("tool call renderer retains labels for multiple visible arguments", () => {
  assert.deepEqual(
    renderToolCallInput("delete", {path: "file.txt", recursive: false}).render(120),
    ["delete", "  path: \"file.txt\"", "  recursive: false"],
  );
});

test("tool result renderer folds head and tail previews", () => {
  const result = {content: [{type: "text" as const, text: "one\ntwo\nthree"}]};

  assert.deepEqual(
    renderToolResultOutput(result, undefined, {expanded: false}, {direction: FoldDirection.HEAD, previewLines: 2}).render(120),
    ["one", "two", `... (1 more line, ${expandHint})`],
  );
  assert.deepEqual(
    renderToolResultOutput(result, undefined, {expanded: false}, {direction: FoldDirection.TAIL, previewLines: 2}).render(120),
    [`... (1 earlier line, ${expandHint})`, "two", "three"],
  );
});

test("expanded tool calls retain a hard argument row limit", () => {
  const args = Object.fromEntries(Array.from({length: 500}, (_, index) => [`arg${index}`, index]));
  const lines = renderToolCallInput("tool", args, undefined, {expanded: true}).render(120);

  assert.equal(lines.length, 201);
  assert.equal(lines[lines.length - 1], "  ... additional arguments omitted");
});

test("tool renderers rebuild theme-derived lines after invalidation", () => {
  let colorCode = "31";
  const theme = {fg: (_color: string, text: string) => `\x1b[${colorCode}m${text}\x1b[0m`};
  const component = renderToolCallInput("tool", {value: "one"}, theme);

  assert.match(component.render(120)[0], /\x1b\[31m/);
  colorCode = "32";
  component.invalidate();
  assert.match(component.render(120)[0], /\x1b\[32m/);
});

test("tool result renderer normalizes line endings", () => {
  const component = renderToolResultOutput({content: [{type: "text", text: "one\rtwo\nthree"}]});
  assert.deepEqual(component.render(120), ["one", "two", "three"]);
});

test("expanded tool results retain a hard row limit", () => {
  const output = Array.from({length: 2_500}, (_, index) => `line ${index}`).join("\n");
  const component = renderToolResultOutput(
    {content: [{type: "text", text: output}]},
    undefined,
    {expanded: true},
    {direction: FoldDirection.TAIL},
  );
  const lines = component.render(120);

  assert.equal(lines.length, 2_000);
  assert.equal(lines[0], "... (501 lines omitted from display)");
  assert.equal(lines[lines.length - 1], "line 2499");
});

test("combined row and character limits still satisfy the expanded row budget", () => {
  const output = "x\n".repeat(110_000);
  const lines = renderToolResultOutput({content: [{type: "text", text: output}]}, undefined, {expanded: true}).render(120);

  assert.equal(lines.length, 2_000);
  assert.equal(lines[lines.length - 1], "[display truncated]");
});

test("character truncation remains visible for whitespace-only output", () => {
  const output = " ".repeat(250_000);
  const lines = renderToolResultOutput(
    {content: [{type: "text", text: output}]},
    undefined,
    {expanded: true},
    {direction: FoldDirection.TAIL},
  ).render(120);
  assert.deepEqual(lines, ["[display truncated]"]);
});

test("collapsed tool results keep character truncation visible", () => {
  const output = "line\n".repeat(50_000);
  const lines = renderToolResultOutput({content: [{type: "text", text: output}]}, undefined, {expanded: false}).render(120);
  assert.equal(lines[lines.length - 1], "[display truncated]");
});

test("tool rendering control toggles global expansion", () => {
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
