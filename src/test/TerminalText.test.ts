import assert from "node:assert/strict";
import {renderLines, truncateToWidth} from "../shared/rendering/terminalText";
import {test} from "./TestHarness";

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

test("terminal lines never exceed the requested width", () => {
  const component = renderLines(["x".repeat(1_000), "a\t".repeat(200), "abc\rdef"]);
  const lines = component.render(20);

  assert.equal(lines.length, 3);
  for (const line of lines) assert.ok(stripAnsi(line).length <= 20, line);
  assert.doesNotMatch(lines[1], /\t/);
  assert.equal(lines[2], "abc def");
});

test("terminal truncation preserves SGR styling and strips other escapes", () => {
  const styled = `\x1b[2m${"x".repeat(100)}\x1b[0m`;
  const cursorMove = "\x1b[1000Cx";
  const hyperlink = "\x1b]8;;https://example.com\x07link\x1b]8;;\x07";

  assert.match(truncateToWidth(styled, 20), /\x1b\[2m/);
  assert.ok(stripAnsi(truncateToWidth(styled, 20)).length <= 20);
  assert.ok(truncateToWidth("\x1b[31mred", 20).endsWith("\x1b[0m"));
  assert.equal(truncateToWidth(cursorMove, 20), "x");
  assert.equal(truncateToWidth(hyperlink, 20), "link");
});

test("terminal truncation accounts for wide Unicode characters", () => {
  const supplementaryCjk = "\u{20000}";

  assert.equal(truncateToWidth(supplementaryCjk.repeat(4), 6), `${supplementaryCjk}${supplementaryCjk}…`);
  assert.equal(truncateToWidth("\uD7B0".repeat(3), 4), "\uD7B0…");
  assert.equal(truncateToWidth("⏳".repeat(3), 4), "⏳…");
});

test("terminal truncation handles invalid widths safely", () => {
  assert.equal(truncateToWidth("too long", Number.NaN), "");
  assert.equal(truncateToWidth("too long", Number.NEGATIVE_INFINITY), "");
  assert.equal(truncateToWidth("too long", 0.5), "");
  assert.equal(truncateToWidth("short", Number.POSITIVE_INFINITY), "short");
});
