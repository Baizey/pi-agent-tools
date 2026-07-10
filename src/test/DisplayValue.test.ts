import assert from "node:assert/strict";
import {formatDisplayValue} from "../shared/rendering/valueFormat";

test("display values format primitives for fields or quoted arguments", () => {
  assert.equal(formatDisplayValue("hello"), "hello");
  assert.equal(formatDisplayValue("hello", {quoteStrings: true}), "\"hello\"");
  assert.equal(formatDisplayValue(42), "42");
});

test("display values bound collections and circular references", () => {
  const circular: {name: string; self?: unknown} = {name: "value"};
  circular.self = circular;

  assert.match(formatDisplayValue(circular), /\[circular]/);
  assert.match(formatDisplayValue(Array.from({length: 20}, (_, index) => index)), /more/);
});

test("display values tolerate throwing property access", () => {
  const hostile = Object.create(null, {
    value: {enumerable: true, get: () => { throw new Error("nope"); }},
  });
  assert.equal(formatDisplayValue(hostile), "[unserializable]");
});
