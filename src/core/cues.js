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

  function newCaptionText(previous, current) {
    if (!previous) return current;
    if (previous === current || previous.endsWith(current)) return "";
    for (let length = Math.min(previous.length, current.length); length > 0; length--) {
      if (previous.slice(-length) === current.slice(0, length) &&
          (length === previous.length || /\s/.test(previous[previous.length - length - 1]) || /[\u3000-\u9fff\uac00-\ud7af]/.test(current[0]))) {
        return current.slice(length).trim();
      }
    }
    return current;
  }

  function shouldFlushLiveCaption(now, lastChangedAt, pendingSince, settleMs = 900, maxWaitMs = 1800) {
    return now - lastChangedAt >= settleMs || now - pendingSince >= maxWaitMs;
  }

  const api = { createCue, parseJson3Captions, buildTranslationRequestParams, newCaptionText, shouldFlushLiveCaption };
  global.YTChineseHelperCore = { ...(global.YTChineseHelperCore || {}), ...api };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
