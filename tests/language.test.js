const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeLanguageCode } = require("../src/core/language.js");

test("normalizes Korean, English and Japanese language codes", () => {
  assert.deepEqual(
    ["ko", "ko-KR", "en", "en-US", "en-GB", "ja", "ja-JP"].map(normalizeLanguageCode),
    ["ko", "ko", "en", "en", "en", "ja", "ja"]
  );
});

test("normalizes Chinese language codes", () => {
  assert.deepEqual(
    ["zh", "zh-CN", "zh-Hans", "zh-TW", "zh-HK", "zh-Hant"].map(normalizeLanguageCode),
    ["zh", "zh", "zh", "zh", "zh", "zh"]
  );
});

test("returns unknown for missing or unsupported language codes", () => {
  assert.deepEqual(["", null, "fr", "xx-YY"].map(normalizeLanguageCode), ["unknown", "unknown", "unknown", "unknown"]);
});
