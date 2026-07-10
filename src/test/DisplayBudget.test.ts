import assert from "node:assert/strict";
import {
  addBoundaryNotice,
  FoldDirection,
  selectDisplayWindow,
  selectTextWindow,
} from "../shared/rendering/displayBudget";

test("display windows select a bounded head or tail", () => {
  assert.deepEqual(selectDisplayWindow([1, 2, 3, 4], 2, FoldDirection.HEAD), {items: [1, 2], omitted: 2});
  assert.deepEqual(selectDisplayWindow([1, 2, 3, 4], 2, FoldDirection.TAIL), {items: [3, 4], omitted: 2});
});

test("display notices are placed at the omitted boundary", () => {
  assert.deepEqual(addBoundaryNotice(["one", "two"], "omitted", FoldDirection.HEAD), ["one", "two", "omitted"]);
  assert.deepEqual(addBoundaryNotice(["one", "two"], "omitted", FoldDirection.TAIL), ["omitted", "one", "two"]);
});

test("text windows bound content before expensive display processing", () => {
  assert.deepEqual(selectTextWindow("123456", 3, FoldDirection.HEAD), {text: "123", truncated: true});
  assert.deepEqual(selectTextWindow("123456", 3, FoldDirection.TAIL), {text: "456", truncated: true});
  assert.deepEqual(selectTextWindow("123456", Number.NaN), {text: "", truncated: true});
});
