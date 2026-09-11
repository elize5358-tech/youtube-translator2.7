const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCue, parseJson3Captions, buildTranslationRequestParams } = require("../src/core/cues.js");
const { newCaptionText, shouldFlushLiveCaption } = require("../src/core/cues.js");

test("rolling captions retain full new content without repeating the previous line", () => {
  assert.equal(newCaptionText("we learn from people", "from people and their experience"), "and their experience");
  assert.equal(newCaptionText("hello world", "hello world"), "");
  assert.equal(newCaptionText("", "a complete sentence"), "a complete sentence");
  assert.equal(newCaptionText("learn", "new sentence"), "new sentence");
});

test("live captions flush after settling or reaching the maximum wait", () => {
  assert.equal(shouldFlushLiveCaption(1500, 1000, 1000), false);
  assert.equal(shouldFlushLiveCaption(1900, 1000, 1000), true);
  assert.equal(shouldFlushLiveCaption(2800, 2600, 1000), true);
});

for (const language of ["korean", "english", "japanese"]) {
  test(`${language} fixture uses the common cue shape`, () => {
    const cues = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `${language}-cues.json`), "utf8"));
    assert.ok(cues.length > 0);
    for (const cue of cues) {
      assert.deepEqual(Object.keys(cue), ["id", "start", "end", "text", "sourceLanguage", "translatedText", "translationStatus"]);
      assert.ok(cue.end > cue.start);
    }
  });
}

test("parses YouTube json3 events into the common cue shape", () => {
  const cues = parseJson3Captions({ events: [{ tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: "  Hello " }, { utf8: " world  " }] }] }, "en-US");
  assert.deepEqual(cues[0], { id: "1", start: 1000, end: 2500, text: "Hello world", sourceLanguage: "en", translatedText: "", translationStatus: "pending" });
});

test("fills cue defaults and preserves the common shape", () => {
  assert.deepEqual(createCue({ text: "  숫자 123  " }), {
    id: "",
    start: 0,
    end: 0,
    text: "숫자 123",
    sourceLanguage: "unknown",
    translatedText: "",
    translationStatus: "pending",
  });
});

test("builds translation request parameters with normalized language codes", () => {
  assert.deepEqual(buildTranslationRequestParams({ text: "안녕하세요", sourceLanguage: "ko-KR", targetLanguage: "zh-CN" }), { q: "안녕하세요", langpair: "ko|zh" });
});
