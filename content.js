(() => {
  if (window.__ytChineseHelperInit) return;
  window.__ytChineseHelperInit = true;

  // ── Settings ──
  const defaults = {
    translateEnabled: true,
    ttsEnabled: true,
    speechRate: 1.0,
    targetLang: "zh",
  };
  let settings = { ...defaults };

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults, (res) => {
        settings = { ...defaults, ...res };
        resolve(settings);
      });
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in settings) settings[key] = newValue;
    }
  });

  // ── Subtitle overlay ──
  let overlay = document.getElementById("yt-chinese-helper-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "yt-chinese-helper-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      bottom: "80px",
      left: "0",
      width: "100%",
      textAlign: "center",
      color: "white",
      fontSize: "22px",
      fontFamily:
        "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      background: "rgba(0,0,0,0.65)",
      padding: "8px 16px",
      zIndex: "9999",
      pointerEvents: "none",
      lineHeight: "1.5",
      textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
      transition: "opacity 0.3s",
    });
    overlay.innerText = "";
    document.body.appendChild(overlay);
  }

  function showOverlay(text) {
    overlay.innerText = text;
    overlay.style.opacity = settings.translateEnabled ? "1" : "0";
  }

  // ── Subtitle extraction ──
  function getVideoId() {
    const url = new URL(window.location.href);
    return url.searchParams.get("v");
  }

  async function getCaptionTracks() {
    const tracks = findCaptionTracksInPage();
    if (tracks?.length) {
      console.log("[YouTube中文助手] 通过页面数据获取字幕:", tracks.length);
      return tracks;
    }

    const htmlTracks = await fetchCaptionTracksFromWatchPage(getVideoId());
    if (htmlTracks?.length) return htmlTracks;

    const listedTracks = await fetchCaptionTracksFromTimedTextList(getVideoId());
    if (listedTracks?.length) return listedTracks;

    return await fetchCaptionViaInnertube(getVideoId());
  }

  function findCaptionTracksInPage() {
    const sources = [
      ...Array.from(document.scripts, (script) => script.textContent || ""),
      document.documentElement.innerHTML,
    ].filter(Boolean);

    for (const source of sources) {
      const playerResponse = extractJsonAfterMarker(source, "ytInitialPlayerResponse", "{");
      const tracks =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) return tracks;

      const directTracks = extractJsonAfterMarker(source, '"captionTracks"', "[");
      if (directTracks?.length) return directTracks;
    }

    return null;
  }

  async function fetchCaptionTracksFromWatchPage(videoId) {
    if (!videoId) return null;

    try {
      const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn("[YouTube中文助手] watch 页请求失败", res.status);
        return null;
      }

      const html = await res.text();
      const tracks = findCaptionTracksInSources([html]);
      if (tracks?.length) {
        console.log("[YouTube中文助手] 通过 watch 页 HTML 获取字幕:", tracks.length);
      }
      return tracks;
    } catch (e) {
      console.warn("[YouTube中文助手] watch 页字幕解析失败", e);
      return null;
    }
  }

  function findCaptionTracksInSources(sources) {
    for (const source of sources) {
      const playerResponse = extractJsonAfterMarker(source, "ytInitialPlayerResponse", "{");
      const tracks =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) return tracks;

      const directTracks = extractJsonAfterMarker(source, '"captionTracks"', "[");
      if (directTracks?.length) return directTracks;
    }

    return null;
  }

  async function fetchCaptionTracksFromTimedTextList(videoId) {
    if (!videoId) return null;

    try {
      const url = `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn("[YouTube中文助手] timedtext 列表请求失败", res.status);
        return null;
      }

      const xml = await res.text();
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      const tracks = Array.from(doc.querySelectorAll("track")).map((track) => {
        const languageCode = track.getAttribute("lang_code") || "";
        const kind = track.getAttribute("kind") || undefined;
        const name = track.getAttribute("name") || "";
        const baseUrl = new URL("https://www.youtube.com/api/timedtext");
        baseUrl.searchParams.set("v", videoId);
        baseUrl.searchParams.set("lang", languageCode);
        if (kind) baseUrl.searchParams.set("kind", kind);
        if (name) baseUrl.searchParams.set("name", name);

        return {
          baseUrl: baseUrl.toString(),
          languageCode,
          kind,
          name: { simpleText: track.getAttribute("lang_original") || languageCode },
        };
      });

      if (tracks.length > 0) {
        console.log("[YouTube中文助手] 通过 timedtext 列表获取字幕:", tracks.length);
      }
      return tracks.length > 0 ? tracks : null;
    } catch (e) {
      console.warn("[YouTube中文助手] timedtext 列表解析失败", e);
      return null;
    }
  }

  function extractJsonAfterMarker(source, marker, openingChar) {
    let markerIndex = source.indexOf(marker);
    while (markerIndex !== -1) {
      const start = source.indexOf(openingChar, markerIndex + marker.length);
      if (start === -1) return null;

      const closingChar = openingChar === "{" ? "}" : "]";
      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let i = start; i < source.length; i++) {
        const char = source[i];

        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;

        if (char === openingChar) depth++;
        if (char === closingChar) depth--;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, i + 1));
          } catch (e) {
            break;
          }
        }
      }

      markerIndex = source.indexOf(marker, markerIndex + marker.length);
    }

    return null;
  }

  async function fetchCaptionViaInnertube(videoId) {
    if (!videoId) return null;
    try {
      const html = document.documentElement.innerHTML;
      const apiKeyMatch =
        html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) ||
        html.match(/"innertubeApiKey":"([^"]+)"/);
      const clientVersionMatch =
        html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) ||
        html.match(/"clientVersion":"([^"]+)"/);
      if (!apiKeyMatch) {
        console.log("[YouTube中文助手] 未找到 innertube API key");
        return null;
      }

      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${apiKeyMatch[1]}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "WEB",
                clientVersion: clientVersionMatch?.[1] || "2.20240101.00.00",
              },
            },
            videoId,
          }),
        }
      );
      if (!res.ok) {
        console.log("[YouTube中文助手] innertube 返回", res.status);
        return null;
      }
      const data = await res.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) {
        console.log("[YouTube中文助手] innertube 获取字幕:", tracks.length);
      }
      return tracks || null;
    } catch (e) {
      console.error("[YouTube中文助手] innertube 请求失败", e);
      return null;
    }
  }

  function selectBestTrack(tracks) {
    // Prefer English, then auto-generated English
    const priority = [
      (t) => t.languageCode === "en" && !t.kind,
      (t) => t.languageCode === "en" && t.kind === "asr",
      (t) => t.languageCode.startsWith("en"),
      (t) => !t.kind, // any manual caption
      (t) => true, // any
    ];
    for (const match of priority) {
      const found = tracks.find(match);
      if (found) return found;
    }
    return tracks[0];
  }

  function rankCaptionTracks(tracks) {
    const best = selectBestTrack(tracks);
    return [
      best,
      ...tracks.filter((track) => track !== best),
    ].filter(Boolean);
  }

  function cleanBaseUrl(url) {
    const u = new URL(url);
    u.searchParams.delete("fmt");
    return u.toString();
  }

  function normalizeYouTubeTargetLang(lang) {
    if (!lang || lang === "zh") return "zh-Hans";
    if (lang === "zh-CN") return "zh-Hans";
    if (lang === "zh-TW" || lang === "zh-HK") return "zh-Hant";
    return lang;
  }

  function buildCaptionUrl(track, params = {}) {
    const url = new URL(cleanBaseUrl(track.baseUrl));
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  function parseJson3Captions(data) {
    const cues = [];
    if (!Array.isArray(data.events)) return cues;

    for (const event of data.events) {
      if (!event.segs) continue;
      const text = event.segs
        .map((segment) => segment.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      cues.push({
        text,
        start: event.tStartMs || 0,
        end: (event.tStartMs || 0) + (event.dDurationMs || 3000),
      });
    }
    return cues;
  }

  async function fetchCaptions(track, options = {}) {
    const captionParams = { fmt: "json3" };
    if (options.translate) {
      captionParams.tlang = normalizeYouTubeTargetLang(settings.targetLang);
    }

    // Try json3 format first (most reliable structured format)
    try {
      const url = buildCaptionUrl(track, captionParams);
      const res = await fetch(url);
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text.startsWith("{") || text.startsWith("[")) {
          const data = JSON.parse(text);
          const cues = parseJson3Captions(data);
          if (cues.length > 0) {
            console.log(
              options.translate
                ? "[YouTube中文助手] YouTube 官方翻译获取成功:"
                : "[YouTube中文助手] json3 获取成功:",
              cues.length,
              "条"
            );
            return cues;
          }
        }
      } else {
        console.warn(
          "[YouTube中文助手] json3 请求失败",
          res.status,
          track.languageCode,
          track.kind || "manual"
        );
      }
    } catch (e) {
      console.warn("[YouTube中文助手] json3 失败", e);
    }

    // Fallback: srv3 (XML with timestamps)
    if (options.translate) return [];

    try {
      const res = await fetch(buildCaptionUrl(track, { fmt: "srv3" }));
      if (res.ok) {
        const xml = await res.text();
        if (xml.includes("<text")) {
          const cues = parseXmlCaptions(xml);
          if (cues.length > 0) {
            console.log("[YouTube中文助手] srv3 获取成功:", cues.length, "条");
            return cues;
          }
        }
      } else {
        console.warn(
          "[YouTube中文助手] srv3 请求失败",
          res.status,
          track.languageCode,
          track.kind || "manual"
        );
      }
    } catch (e) {
      console.warn("[YouTube中文助手] srv3 失败", e);
    }

    // Last resort: default response (usually srv1 XML)
    try {
      const res = await fetch(buildCaptionUrl(track));
      if (res.ok) {
        const xml = await res.text();
        const cues = parseXmlCaptions(xml);
        if (cues.length > 0) {
          console.log("[YouTube中文助手] 默认格式获取成功:", cues.length, "条");
          return cues;
        }
      } else {
        console.warn(
          "[YouTube中文助手] 默认字幕请求失败",
          res.status,
          track.languageCode,
          track.kind || "manual"
        );
      }
    } catch (e) {
      console.error("[YouTube中文助手] 所有格式均失败", e);
    }

    return [];
  }

  function parseXmlCaptions(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const nodes = doc.querySelectorAll("text");
    const cues = [];
    for (const node of nodes) {
      const content = node.textContent?.trim().replace(/\s+/g, " ");
      if (!content) continue;
      const start = parseFloat(node.getAttribute("start") || "0") * 1000;
      const dur = parseFloat(node.getAttribute("dur") || "3") * 1000;
      cues.push({ text: content, start, end: start + dur });
    }
    return cues;
  }

  // ── Translation ──
  const translationCache = new Map();

  async function translate(text) {
    if (translationCache.has(text)) return translationCache.get(text);
    if (!text.trim()) return text;

    try {
      const langPair = `en|${settings.targetLang}`;
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const translated =
        data.responseData?.translatedText || text;
      translationCache.set(text, translated);
      return translated;
    } catch (e) {
      console.error("翻译失败", e);
      return text;
    }
  }

  async function translateBatch(cues) {
    const results = [];
    for (const cue of cues) {
      if (translationCache.has(cue.text)) {
        results.push({ ...cue, translated: translationCache.get(cue.text) });
        continue;
      }
      const translated = await translate(cue.text);
      results.push({ ...cue, translated });
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 200));
    }
    return results;
  }

  // ── Speech synthesis ──
  let speakQueue = [];
  let isSpeaking = false;
  let bestVoice = null;
  let speakToken = 0;

  function loadVoices() {
    const voices = speechSynthesis.getVoices();
    const zhVoices = voices.filter(
      (v) => v.lang.startsWith("zh") || v.lang.startsWith("cmn")
    );
    if (zhVoices.length === 0) return;

    // Prefer specific high-quality voices on macOS
    const preferredNames = [
      "Ting-Ting",
      "Li-mu",
      "Li-Mu",
      "Tingting",
      "Google 普通话（中国大陆）",
      "Microsoft Xiaoxiao",
    ];
    for (const name of preferredNames) {
      const found = zhVoices.find((v) => v.name.includes(name));
      if (found) {
        bestVoice = found;
        return;
      }
    }
    bestVoice = zhVoices[0];
  }

  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();

  function speak(text) {
    if (!settings.ttsEnabled) return;
    if (!text) return;

    speakQueue = [];
    speechSynthesis.cancel();
    isSpeaking = true;
    const token = ++speakToken;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = settings.speechRate;
    if (bestVoice) utterance.voice = bestVoice;

    utterance.onend = () => {
      if (token === speakToken) isSpeaking = false;
    };
    utterance.onerror = () => {
      if (token === speakToken) isSpeaking = false;
    };

    speechSynthesis.speak(utterance);
  }

  // ── Main loop ──
  let captionCues = [];
  let translatedCues = [];
  let currentVideoId = null;
  let lastSpokenIndex = -1;
  let pollTimer = null;
  let isInitialized = false;
  let liveCaptionMode = false;
  let lastLiveCaptionText = "";
  let lastLiveTranslatedText = "";
  let lastLiveSpokenText = "";
  let liveTranslateInFlight = false;

  function getCurrentTimeMs() {
    const video = document.querySelector("video");
    return video ? video.currentTime * 1000 : 0;
  }

  function findCurrentCue(timeMs) {
    for (let i = 0; i < translatedCues.length; i++) {
      if (timeMs >= translatedCues[i].start && timeMs <= translatedCues[i].end) {
        return i;
      }
    }
    return -1;
  }

  async function initForVideo() {
    const videoId = getVideoId();
    if (!videoId || videoId === currentVideoId) return;
    currentVideoId = videoId;
    isInitialized = false;
    liveCaptionMode = false;
    lastLiveCaptionText = "";
    lastLiveTranslatedText = "";
    lastLiveSpokenText = "";
    liveTranslateInFlight = false;
    captionCues = [];
    translatedCues = [];
    lastSpokenIndex = -1;
    translationCache.clear();
    speakQueue = [];
    speechSynthesis.cancel();
    isSpeaking = false;
    speakToken++;

    showOverlay("正在加载字幕...");

    // Wait for player to be ready
    await waitForPlayer();

    // Retry getting caption tracks (page may not be fully loaded)
    let tracks = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      tracks = await getCaptionTracks();
      if (tracks && tracks.length > 0) break;
      console.log(`[YouTube中文助手] 第${attempt + 1}次尝试获取字幕轨道...`);
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!tracks || tracks.length === 0) {
      showOverlay("此视频无可用字幕");
      return;
    }

    const bestTrack = selectBestTrack(tracks);
    console.log("[YouTube中文助手] 使用字幕轨道:", bestTrack.languageCode, bestTrack.kind || "manual");

    const rankedTracks = rankCaptionTracks(tracks);
    let sourceTrack = bestTrack;
    let youtubeTranslatedCues = [];
    for (const track of rankedTracks) {
      youtubeTranslatedCues = await fetchCaptions(track, { translate: true });
      if (youtubeTranslatedCues.length > 0) {
        sourceTrack = track;
        break;
      }
    }
    if (youtubeTranslatedCues.length > 0) {
      translatedCues = youtubeTranslatedCues.map((cue) => ({
        ...cue,
        translated: cue.text,
      }));
      captionCues = youtubeTranslatedCues;
      isInitialized = true;
      showOverlay("翻译完成，开始播放");
      return;
    }

    captionCues = [];
    for (const track of rankedTracks) {
      captionCues = await fetchCaptions(track);
      if (captionCues.length > 0) {
        sourceTrack = track;
        console.log(
          "[YouTube中文助手] 使用可下载字幕轨道:",
          sourceTrack.languageCode,
          sourceTrack.kind || "manual"
        );
        break;
      }
    }
    if (captionCues.length === 0) {
      liveCaptionMode = true;
      isInitialized = true;
      enableYouTubeCaptions();
      showOverlay("已切换实时字幕模式");
      console.warn("[YouTube中文助手] 字幕文件下载失败，切换实时字幕模式");
      return;
    }

    showOverlay("正在翻译字幕...");
    translatedCues = await translateBatch(captionCues);
    isInitialized = true;
    showOverlay("翻译完成，开始播放");
  }

  function enableYouTubeCaptions() {
    const button = document.querySelector(".ytp-subtitles-button");
    if (!button) return;

    const pressed = button.getAttribute("aria-pressed");
    const title = button.getAttribute("title") || "";
    if (pressed === "false" || title.includes("Subtitles/closed captions off")) {
      button.click();
    }
  }

  function getVisibleYouTubeCaptionText() {
    const segmentNodes = Array.from(document.querySelectorAll(".ytp-caption-segment"));
    const fallbackNodes = Array.from(
      document.querySelectorAll(".caption-window .captions-text")
    );
    const nodes = segmentNodes.length > 0 ? segmentNodes : fallbackNodes;
    const seen = new Set();

    return nodes
      .filter((node) => {
        const style = window.getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((node) => normalizeCaptionText(node.textContent || ""))
      .filter((text) => {
        if (!text || seen.has(text)) return false;
        seen.add(text);
        return true;
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeCaptionText(text) {
    return text
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function pollLiveCaption() {
    const text = getVisibleYouTubeCaptionText();
    if (!text) {
      if (!lastLiveCaptionText) showOverlay("请开启 YouTube 原字幕");
      return;
    }

    if (text === lastLiveCaptionText) {
      if (lastLiveTranslatedText) showOverlay(lastLiveTranslatedText);
      return;
    }

    lastLiveCaptionText = text;
    if (liveTranslateInFlight) return;

    liveTranslateInFlight = true;
    try {
      const translated = await translate(text);
      if (text === lastLiveCaptionText) {
        lastLiveTranslatedText = translated;
        showOverlay(translated);
        if (settings.ttsEnabled && text !== lastLiveSpokenText) {
          lastLiveSpokenText = text;
          speak(translated);
        }
      }
    } finally {
      liveTranslateInFlight = false;
    }
  }

  function waitForPlayer() {
    return new Promise((resolve) => {
      let elapsed = 0;
      const check = () => {
        const video = document.querySelector("video");
        if (video && video.readyState >= 2) {
          resolve();
        } else if (elapsed > 15000) {
          resolve(); // timeout, proceed anyway
        } else {
          elapsed += 500;
          setTimeout(check, 500);
        }
      };
      check();
    });
  }

  async function pollSubtitles() {
    if (!isInitialized || !settings.translateEnabled) return;

    if (liveCaptionMode) {
      await pollLiveCaption();
      return;
    }

    const timeMs = getCurrentTimeMs();
    const cueIndex = findCurrentCue(timeMs);

    if (cueIndex >= 0) {
      const cue = translatedCues[cueIndex];
      showOverlay(cue.translated);

      // Speak if new cue and TTS is enabled
      if (cueIndex !== lastSpokenIndex) {
        lastSpokenIndex = cueIndex;
        if (settings.ttsEnabled) {
          speak(cue.translated);
        }
      }
    } else {
      showOverlay("");
    }
  }

  // ── Navigation handling ──
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollSubtitles, 300);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    speechSynthesis.cancel();
    speakQueue = [];
    isSpeaking = false;
    speakToken++;
  }

  // Handle YouTube SPA navigation
  function handleNavigation() {
    if (location.pathname === "/watch") {
      const newVideoId = getVideoId();
      if (newVideoId !== currentVideoId) {
        currentVideoId = null; // force re-init
      }
      stopPolling();
      setTimeout(async () => {
        await initForVideo();
        startPolling();
      }, 1000);
    } else {
      stopPolling();
      showOverlay("");
    }
  }

  // Method 1: YouTube's own navigation event
  window.addEventListener("yt-navigate-finish", handleNavigation);

  // Method 2: URL change detection via MutationObserver
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handleNavigation();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Bootstrap ──
  async function bootstrap() {
    await loadSettings();
    if (location.pathname === "/watch") {
      await initForVideo();
      startPolling();
    }
  }

  if (document.readyState === "complete") {
    bootstrap();
  } else {
    window.addEventListener("load", bootstrap);
  }
})();
