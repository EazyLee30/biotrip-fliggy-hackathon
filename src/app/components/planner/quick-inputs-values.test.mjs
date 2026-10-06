import assert from "node:assert/strict";
import test from "node:test";
import { hasExactPhrase, toggleExactPhrase, uniquePhrases } from "./quick-inputs-values.ts";

test("phrase choices deduplicate only exact strings", () => {
  assert.deepEqual(uniquePhrases(["少走路", "多休息", "少走路", "少走路 ", "", "  "]), ["少走路", "多休息", "少走路 "]);
});

test("similar free text never counts as an exact selected phrase", () => {
  assert.equal(hasExactPhrase("今天想少走路", "少走路"), false);
  assert.equal(hasExactPhrase("少走路 ", "少走路"), false);
  assert.equal(hasExactPhrase("我的备注\r\n少走路\r\n多休息", "少走路"), true);
  assert.equal(toggleExactPhrase("今天想少走路", "少走路"), "今天想少走路\n少走路");
});

test("phrase toggles preserve free text and remove repeated exact lines", () => {
  const value = "想看看海\n少走路\n晚上少走路\n少走路";
  assert.equal(toggleExactPhrase(value, "少走路"), "想看看海\n晚上少走路");
  assert.equal(toggleExactPhrase("", "多休息"), "多休息");
  assert.equal(toggleExactPhrase("备注\n", "多休息"), "备注\n多休息");
});

test("phrase insertion fits the complete expression or preserves the input", () => {
  assert.equal(toggleExactPhrase("备注", "多休息", 6), "备注\n多休息");
  assert.equal(toggleExactPhrase("备注", "多休息", 5), "备注");
  assert.equal(toggleExactPhrase("", "多休息", 0), "");
  assert.equal(toggleExactPhrase("备注", "  ", 10), "备注");
  assert.equal(toggleExactPhrase("多休息", "多休息", 1), "");
});

test("each new controlled value is used without restoring an old phrase choice", () => {
  assert.equal(toggleExactPhrase("外部更新的备注", "多休息"), "外部更新的备注\n多休息");
  assert.equal(toggleExactPhrase("", "多休息"), "多休息");
});
