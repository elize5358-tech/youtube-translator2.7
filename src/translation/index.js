(function (global) {
  const cache = new Map();
  const SUPPORTED_SOURCE_LANGUAGES = new Set(["ko", "en", "ja"]);

  function createResult({
    text,
    status,
    provider,
    sourceLanguage,
    targetLanguage,
    cached = false,
    error = null,
  }) {
    return {
      text,
      status,
      provider,
      sourceLanguage,
      targetLanguage,
      cached,
      error,
    };
  }

  async function translateText({
    text,
    sourceLanguage,
    targetLanguage = "zh-CN",
  }) {
    const source = global.YTChineseHelper.normalizeLanguageCode(sourceLanguage);
    const target = targetLanguage === "zh" ? "zh-CN" : targetLanguage || "zh-CN";
    const originalText = text || "";
    const key = `${source}|${target}|${originalText}`;
    if (cache.has(key)) {
      return createResult({ ...cache.get(key), cached: true });
    }
    if (!originalText.trim()) {
      return createResult({
        text: originalText,
        status: "translated",
        provider: null,
        sourceLanguage: source,
        targetLanguage: target,
      });
    }
    if (!SUPPORTED_SOURCE_LANGUAGES.has(source)) {
      return createResult({
        text: originalText,
        status: "unsupported-language",
        provider: null,
        sourceLanguage: source,
        targetLanguage: target,
        error: {
          code: "UNSUPPORTED_SOURCE_LANGUAGE",
          message: `Unsupported source language: ${source}`,
        },
      });
    }

    let provider = "chrome";
    let result = await global.YTChineseHelper.translateWithChrome({
      text: originalText,
      sourceLanguage: source,
      targetLanguage: target,
    });
    if (result.status === "unavailable") {
      provider = "mymemory";
      result = await global.YTChineseHelper.translateWithMyMemory({
        text: originalText,
        sourceLanguage: source,
        targetLanguage: target,
      });
    }
    const normalized = createResult({
      text: result.status === "translated" ? result.text : originalText,
      status: result.status === "translated" ? "translated" : "fallback-original",
      provider,
      sourceLanguage: source,
      targetLanguage: target,
      error: result.status === "translated" ? null : result.error,
    });
    if (normalized.status === "translated") cache.set(key, normalized);
    return normalized;
  }

  function clearTranslationCache() {
    cache.clear();
    global.YTChineseHelper.clearChromeTranslators?.();
  }

  global.YTChineseHelper = global.YTChineseHelper || {};
  global.YTChineseHelper.translateText = translateText;
  global.YTChineseHelper.clearTranslationCache = clearTranslationCache;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { translateText, clearTranslationCache };
  }
})(globalThis);
