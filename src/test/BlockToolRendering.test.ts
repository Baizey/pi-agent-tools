import assert from "node:assert/strict";
import {renderBashCall} from "../extensions/policy/shell-policy/bash-renderer";
import {renderCodeExecCall} from "../extensions/tools/code-exec/rendering";
import {renderBlockToolCall} from "../shared/blockToolRendering";
import {
  FoldDirection,
  ToolRenderDefaultKeyText,
  ToolRenderKeybindingDescription,
} from "../shared/toolRendering";
import {test} from "./TestHarness";

const expandHint = `${ToolRenderDefaultKeyText.TOOLS_EXPAND} ${ToolRenderKeybindingDescription.EXPAND}`;

test("block tool renderer folds head and tail previews", () => {
  const block = "first\nsecond\nthird";

  assert.deepEqual(
    renderBlockToolCall({
      title: "bash",
      fields: [{label: "timeout", value: 30}],
      block: {label: "command", text: block},
      fold: {previewLines: 2},
    }, undefined, {expanded: false}).render(120),
    ["bash", "  timeout: 30", "  command:", "    first", "    second", `    ... (1 more line, ${expandHint})`],
  );
  assert.deepEqual(
    renderBlockToolCall({
      title: "execute_code",
      block: {label: "code", text: block},
      fold: {direction: FoldDirection.TAIL, previewLines: 2},
    }, undefined, {expanded: false}).render(120),
    ["execute_code", "  code:", `    ... (1 earlier line, ${expandHint})`, "    second", "    third"],
  );
});

test("block tool renderer shows expanded content", () => {
  assert.deepEqual(
    renderBlockToolCall({title: "bash", block: {label: "command", text: "first\nsecond"}}, undefined, {expanded: true}).render(120),
    ["bash", "  command:", "    first", "    second"],
  );
});

test("block tool renderer bounds rows, characters, and line width", () => {
  const manyLines = Array.from({length: 2_500}, (_, index) => `line ${index}`).join("\n");
  const renderedLines = renderBlockToolCall({title: "execute_code", block: {label: "code", text: manyLines}}, undefined, {expanded: true}).render(120);
  assert.equal(renderedLines.length, 2_002);
  assert.equal(renderedLines[renderedLines.length - 1], "    ... (501 lines omitted from display)");

  const longLine = renderBlockToolCall({title: "execute_code", block: {label: "code", text: "x".repeat(250_000)}}, undefined, {expanded: true}).render(80);
  assert.equal(longLine[longLine.length - 1], "    [block display truncated]");
  assert.ok(longLine.every(line => line.length <= 80));
});

test("block tool renderer bounds structured fields", () => {
  const fields = Array.from({length: 200}, (_, index) => ({label: `field${index}`, value: index}));
  const lines = renderBlockToolCall({
    title: "tool",
    fields,
    block: {label: "code", text: "value"},
  }, undefined, {expanded: true}).render(120);

  assert.equal(lines.length, 102);
  assert.equal(lines[100], "  ... additional fields omitted");
});

test("collapsed block output keeps character truncation visible", () => {
  const largeBlock = "line\n".repeat(50_000);
  const lines = renderBlockToolCall({
    title: "execute_code",
    block: {label: "code", text: largeBlock},
  }, undefined, {expanded: false}).render(120);

  assert.equal(lines[lines.length - 1], "    [block display truncated]");
});

test("bash call renderer shows purpose and command", () => {
  const lines = renderBashCall({command: "echo hello", purpose: "greet", timeout: 5}, undefined, {expanded: true}).render(120);
  assert.deepEqual(lines, ["bash", "  purpose: greet", "  timeout: 5", "  command: echo hello"]);
});

test("code call renderer applies terminal width limits", () => {
  const wide = "\u{20000}";
  const component = renderCodeExecCall({language: "javascript", code: wide.repeat(20)}, undefined, {expanded: true});
  assert.equal(component.render(10)[3], "  code: …");
});
