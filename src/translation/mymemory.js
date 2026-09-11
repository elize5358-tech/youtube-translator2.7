(function (global) {
  const SUPPORTED_SOURCE_LANGUAGES = new Set(["ko", "en", "ja"]);
  const MAX_QUERY_LENGTH = 450;
  const chromeTranslators = new Map();

  function apiTargetLanguage(targetLanguage) {
    return targetLanguage === "zh-CN" ? "zh" : targetLanguage;
  }

  async function translateWithChrome({
    text,
    sourceLanguage,
    targetLanguage = "zh-CN",
  }) {
    if (!global.Translator) {
      return {
        text,
        status: "unavailable",
        error: {
          code: "BUILTIN_TRANSLATOR_UNAVAILABLE",
          message: "Chrome Translator API is unavailable",
        },
      };
    }

    const source = global.YTChineseHelper.normalizeLanguageCode(sourceLanguage);
    const target = apiTargetLanguage(targetLanguage);
    const options = { sourceLanguage: source, targetLanguage: target };

    try {
      const availability = await global.Translator.availability(options);
      if (availability === "unavailable") {
        return {
          text,
          status: "unavailable",
          error: {
            code: "BUILTIN_LANGUAGE_PAIR_UNAVAILABLE",
            message: `Chrome cannot translate ${source} to ${target}`,
          },
        };
      }

      const key = `${source}|${target}`;
      let translator = chromeTranslators.get(key);
      if (!translator) {
        translator = await global.Translator.create(options);
        chromeTranslators.set(key, translator);
      }

      return {
        text: await translator.translate(text),
        status: "translated",
      };
    } catch (error) {
      return {
        text,
        status: "failed",
        error: {
          code: "BUILTIN_TRANSLATOR_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  function clearChromeTranslators() {
    for (const translator of chromeTranslators.values()) translator.destroy?.();
    chromeTranslators.clear();
  }

  function splitText(text) {
    const chunks = [];
    let remaining = String(text || "").replace(/\s+/g, " ").trim();

    while (remaining.length > MAX_QUERY_LENGTH) {
      const candidate = remaining.slice(0, MAX_QUERY_LENGTH);
      const punctuationBreak = Math.max(
        candidate.lastIndexOf(". ") + 1,
        candidate.lastIndexOf("? ") + 1,
        candidate.lastIndexOf("! ") + 1,
        candidate.lastIndexOf("。") + 1,
        candidate.lastIndexOf("？") + 1,
        candidate.lastIndexOf("！") + 1,
        candidate.lastIndexOf("；") + 1
      );
      const whitespaceBreak = candidate.lastIndexOf(" ");
      const cut = punctuationBreak > 0 ? punctuationBreak : whitespaceBreak > 0 ? whitespaceBreak : MAX_QUERY_LENGTH;
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }

    if (remaining) chunks.push(remaining);
    return chunks;
  }

  async function translateChunk(text, source, target) {
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
    const responseStatus = Number(data.responseStatus || 200);
    if (responseStatus !== 200) {
      throw new Error(data.responseDetails || `Provider status ${responseStatus}`);
    }
    if (!translatedText) throw new Error("Missing translated text");
    if (/QUERY LENGTH LIMIT EXCEEDED/i.test(translatedText)) {
      throw new Error(translatedText);
    }
    return translatedText;
  }

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
      const chunks = splitText(text);
      const translatedChunks = [];
      for (const chunk of chunks) {
        translatedChunks.push(await translateChunk(chunk, source, target));
      }
      return { text: translatedChunks.join(" "), status: "translated" };
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
  global.YTChineseHelper.translateWithChrome = translateWithChrome;
  global.YTChineseHelper.clearChromeTranslators = clearChromeTranslators;
  global.YTChineseHelper.translateWithMyMemory = translateWithMyMemory;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      translateWithChrome,
      clearChromeTranslators,
      translateWithMyMemory,
    };
  }
})(globalThis);
