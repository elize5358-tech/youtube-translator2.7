(function (global) {
  "use strict";

  function normalizeLanguageCode(language) {
    const code = String(language || "").trim().toLowerCase().replace(/_/g, "-");
    if (!code) return "unknown";
    const base = code.split("-")[0];
    if (["ko", "en", "ja", "zh"].includes(base)) return base;
    return "unknown";
  }

  const api = { normalizeLanguageCode };
  global.YTChineseHelperCore = { ...(global.YTChineseHelperCore || {}), ...api };
  global.YTChineseHelper = { ...(global.YTChineseHelper || {}), ...api };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
