(function (global) {
  "use strict";

  const { normalizeLanguageCode } = global.YTChineseHelperCore || require("./language.js");

  function createCue({ id = "", start = 0, end = 0, text = "", sourceLanguage = "unknown", translatedText = "", translationStatus = "pending" } = {}) {
    return {
      id: String(id),
      start: Number.isFinite(Number(start)) ? Number(start) : 0,
      end: Number.isFinite(Number(end)) ? Number(end) : 0,
      text: String(text).replace(/\s+/g, " ").trim(),
      sourceLanguage: normalizeLanguageCode(sourceLanguage),
      translatedText: String(translatedText),
      translationStatus,
    };
  }

  function parseJson3Captions(data, sourceLanguage = "") {
    if (!Array.isArray(data?.events)) return [];
    return data.events.reduce((cues, event, index) => {
      if (!event.segs) return cues;
      const text = event.segs.map((segment) => segment.utf8 || "").join("").replace(/\s+/g, " ").trim();
      if (!text) return cues;
      const start = event.tStartMs || 0;
      cues.push(createCue({
        id: String(index + 1),
        start,
        end: start + (event.dDurationMs || 3000),
        text,
        sourceLanguage,
      }));
      return cues;
    }, []);
  }

  function buildTranslationRequestParams({ text, sourceLanguage, targetLanguage = "zh" }) {
    return {
      q: String(text || ""),
      langpair: `${normalizeLanguageCode(sourceLanguage) || "auto"}|${normalizeLanguageCode(targetLanguage) || "zh"}`,
    };
  }

  const api = { createCue, parseJson3Captions, buildTranslationRequestParams };
  global.YTChineseHelperCore = { ...(global.YTChineseHelperCore || {}), ...api };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
