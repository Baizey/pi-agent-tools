import assert from "node:assert/strict";
import {BoundedTextBuffer, TextRetention, truncateText} from "../shared/boundedText";

test("bounded text buffer retains content up to its limit across chunks", () => {
  const output = new BoundedTextBuffer(5);
  output.append("12");
  output.append("345");
  assert.equal(output.value(), "12345");
  assert.equal(output.wasTruncated(), false);

  output.append("67");
  assert.equal(output.value(), "12345\n[truncated]");
  assert.equal(output.wasTruncated(), true);
});

test("bounded text buffer can retain the tail", () => {
  const output = new BoundedTextBuffer(5, "[truncated]", TextRetention.TAIL);
  output.append("123");
  output.append("4567");
  assert.equal(output.content(), "34567");
  assert.equal(output.value(), "[truncated]\n34567");
});

test("truncateText applies the same bounded-text contract", () => {
  assert.equal(truncateText("12345", 5), "12345");
  assert.equal(truncateText("123456", 5), "12345\n[truncated]");
});
