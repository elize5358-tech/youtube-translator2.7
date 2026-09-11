const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/core/language.js");
require("../src/translation/mymemory.js");
const { translateText, clearTranslationCache } = require("../src/translation/index.js");

const originalFetch = globalThis.fetch;
const originalTranslator = globalThis.Translator;
const RESULT_FIELDS = [
  "text", "status", "provider", "sourceLanguage", "targetLanguage", "cached", "error",
];

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Translator = originalTranslator;
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

test("prefers Chrome's built-in translator without an online request", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("online provider should not be called");
  };
  globalThis.Translator = {
    async availability(options) {
      assert.deepEqual(options, { sourceLanguage: "en", targetLanguage: "zh" });
      return "available";
    },
    async create() {
      return { async translate() { return "你好，世界"; } };
    },
  };

  const result = await translateText({ text: "hello world", sourceLanguage: "en" });
  assert.equal(result.text, "你好，世界");
  assert.equal(result.provider, "chrome");
  assert.equal(fetchCalls, 0);
});

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

test("provider query-length errors are not treated as translations or cached", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return {
      ok: true,
      async json() {
        return {
          responseData: {
            translatedText: "QUERY LENGTH LIMIT EXCEEDED. MAX ALLOWED QUERY : 500 CHARS",
          },
        };
      },
    };
  };

  const first = await translateText({ text: "hello", sourceLanguage: "en" });
  const second = await translateText({ text: "hello", sourceLanguage: "en" });
  assert.equal(first.status, "fallback-original");
  assert.equal(first.text, "hello");
  assert.equal(first.error.code, "PROVIDER_ERROR");
  assert.equal(second.cached, false);
  assert.equal(requests, 2);
});

test("long text is translated in requests below the provider limit", async () => {
  const queryLengths = [];
  globalThis.fetch = async (url) => {
    const query = new URL(String(url)).searchParams.get("q");
    queryLengths.push(query.length);
    return {
      ok: true,
      async json() {
        return { responseData: { translatedText: `译文${queryLengths.length}` } };
      },
    };
  };

  const result = await translateText({
    text: `${"a".repeat(440)} ${"b".repeat(100)}`,
    sourceLanguage: "en",
  });
  assert.equal(result.status, "translated");
  assert.equal(result.text, "译文1 译文2");
  assert.deepEqual(queryLengths, [440, 100]);
  assert.ok(queryLengths.every((length) => length <= 450));
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
