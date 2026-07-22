const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/core/language.js");
require("../src/translation/mymemory.js");
const { translateText, clearTranslationCache } = require("../src/translation/index.js");

const originalFetch = globalThis.fetch;
const RESULT_FIELDS = [
  "text", "status", "provider", "sourceLanguage", "targetLanguage", "cached", "error",
];

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTranslationCache();
});

function mockFetch(translatedText = "译文") {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      async json() {
        return { responseData: { translatedText } };
      },
    };
  };
  return requests;
}

for (const [input, source] of [["ko-KR", "ko"], ["en-US", "en"], ["ja-JP", "ja"]]) {
  test(`${input} requests ${source}|zh-CN`, async () => {
    const requests = mockFetch();
    const result = await translateText({ text: "hello", sourceLanguage: input });
    assert.deepEqual(Object.keys(result), RESULT_FIELDS);
    assert.equal(result.status, "translated");
    assert.equal(result.sourceLanguage, source);
    assert.equal(result.targetLanguage, "zh-CN");
    assert.match(requests[0], new RegExp(`langpair=${source}%7Czh-CN`));
  });
}

for (const sourceLanguage of ["unknown", "", "fr-FR"]) {
  test(`${JSON.stringify(sourceLanguage)} does not call fetch`, async () => {
    const requests = mockFetch();
    const result = await translateText({ text: "hello", sourceLanguage });
    assert.deepEqual(Object.keys(result), RESULT_FIELDS);
    assert.equal(result.status, "unsupported-language");
    assert.equal(result.provider, null);
    assert.equal(result.sourceLanguage, "unknown");
    assert.equal(requests.length, 0);
  });
}

test("provider failure falls back to the original text with the common contract", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const result = await translateText({ text: "hello", sourceLanguage: "en" });
  assert.deepEqual(Object.keys(result), RESULT_FIELDS);
  assert.equal(result.text, "hello");
  assert.equal(result.status, "fallback-original");
  assert.equal(result.error.code, "PROVIDER_ERROR");
});

test("cache is language-aware and clearTranslationCache forces a new request", async () => {
  const requests = mockFetch("cached");
  const first = await translateText({ text: "same", sourceLanguage: "en" });
  const cached = await translateText({ text: "same", sourceLanguage: "en" });
  const differentLanguage = await translateText({ text: "same", sourceLanguage: "ko" });
  assert.equal(first.cached, false);
  assert.equal(cached.cached, true);
  assert.equal(differentLanguage.cached, false);
  assert.equal(requests.length, 2);

  clearTranslationCache();
  await translateText({ text: "same", sourceLanguage: "en" });
  assert.equal(requests.length, 3);
});
