(function (global) {
  const SUPPORTED_SOURCE_LANGUAGES = new Set(["ko", "en", "ja"]);

  async function translateWithMyMemory({
    text,
    sourceLanguage,
    targetLanguage = "zh-CN",
  }) {
    const source = global.YTChineseHelper.normalizeLanguageCode(sourceLanguage);
    const target = targetLanguage || "zh-CN";
    if (!text?.trim()) return { text: text || "", status: "translated" };
    if (!SUPPORTED_SOURCE_LANGUAGES.has(source)) {
      return {
        text,
        status: "failed",
        error: {
          code: "UNSUPPORTED_SOURCE_LANGUAGE",
          message: `Unsupported source language: ${source}`,
        },
      };
    }

    try {
      const params = new URLSearchParams({
        q: text,
        langpair: `${source}|${target}`,
      });
      const response = await fetch(
        `https://api.mymemory.translated.net/get?${params.toString()}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const translatedText = data.responseData?.translatedText;
      if (!translatedText) throw new Error("Missing translated text");
      return { text: translatedText, status: "translated" };
    } catch (error) {
      return {
        text,
        status: "failed",
        error: {
          code: "PROVIDER_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  global.YTChineseHelper = global.YTChineseHelper || {};
  global.YTChineseHelper.translateWithMyMemory = translateWithMyMemory;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { translateWithMyMemory };
  }
})(globalThis);
