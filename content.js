(() => {
  if (window.__ytChineseHelperInit) return;
  window.__ytChineseHelperInit = true;

  // ── Settings ──
  const defaults = {
    translateEnabled: true,
    ttsEnabled: true,
    speechRate: 1.0,
    targetLang: "zh-CN",
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
    if (!settings.ttsEnabled || !settings.translateEnabled) {
      speakToken++;
      speechSynthesis.cancel();
      speakQueue = [];
      isSpeaking = false;
      releaseVideo();
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
    const language = (track) =>
      YTChineseHelper.normalizeLanguageCode(track.languageCode);
    const supported = (track) => ["ko", "en", "ja"].includes(language(track));
    const priority = [
      (t) => supported(t) && !t.kind,
      (t) => supported(t) && t.kind === "asr",
      (t) => !t.kind,
      (t) => true,
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

  function fetchCaptionResource(url) {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === window.location.hostname) {
      return fetch(url, {
        credentials: "include",
        cache: "no-store",
      })
        .then(async (response) => ({
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        }))
        .catch((error) => ({
          ok: false,
          status: 0,
          body: "",
          error: error instanceof Error ? error.message : String(error),
        }));
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "FETCH_YOUTUBE_CAPTIONS", url },
        (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            resolve({ ok: false, status: 0, body: "", error: runtimeError.message });
            return;
          }
          resolve(response || { ok: false, status: 0, body: "", error: "No response" });
        }
      );
    });
  }

  function logCaptionResponse(format, translated, response) {
    const status = response.status || 0;
    const bytes = response.body?.length || 0;
    const outcome = response.ok && bytes > 0 ? "成功" : "失败";
    console.info(
      `[YouTube中文助手] 字幕请求${outcome}`,
      `format=${format}`,
      `translated=${translated}`,
      `status=${status}`,
      `bytes=${bytes}`,
      response.error ? `error=${response.error}` : ""
    );
  }

  let captionRequestsRateLimited = false;

  async function fetchCaptions(track, options = {}) {
    if (captionRequestsRateLimited) return [];
    const captionParams = { fmt: "json3" };
    if (options.translate) {
      captionParams.tlang = normalizeYouTubeTargetLang(settings.targetLang);
    }

    // Try json3 format first (most reliable structured format)
    try {
      const url = buildCaptionUrl(track, captionParams);
      const res = await fetchCaptionResource(url);
      logCaptionResponse("json3", Boolean(options.translate), res);
      if (res.status === 429) captionRequestsRateLimited = true;
      if (res.ok) {
        const text = res.body.trim();
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
      const res = await fetchCaptionResource(buildCaptionUrl(track, { fmt: "srv3" }));
      logCaptionResponse("srv3", false, res);
      if (res.ok) {
        const xml = res.body;
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
      const res = await fetchCaptionResource(buildCaptionUrl(track));
      logCaptionResponse("default", false, res);
      if (res.ok) {
        const xml = res.body;
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
  async function translate(text, sourceLanguage) {
    const result = await YTChineseHelper.translateText({
      text,
      sourceLanguage,
      targetLanguage: settings.targetLang,
    });
    return result;
  }

  async function translateBatch(cues, sourceLanguage) {
    const results = [];
    const batchSize = 3;
    for (let index = 0; index < cues.length; index += batchSize) {
      const batch = cues.slice(index, index + batchSize);
      const translatedBatch = await Promise.all(
        batch.map(async (cue) => {
          const result = await translate(cue.text, sourceLanguage);
          return {
            ...cue,
            translated: result.text,
            translationStatus: result.status,
          };
        })
      );
      results.push(...translatedBatch);
      if (index + batchSize < cues.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return results;
  }

  // ── Speech synthesis ──
  let speakQueue = [];
  let isSpeaking = false;
  let bestVoice = null;
  let speakToken = 0;
  let heldVideo = null;

  function releaseVideo() {
    const video = heldVideo;
    heldVideo = null;
    if (video && video.paused && !video.ended) video.play().catch(() => {});
  }

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

  function prepareSpeechText(text) {
    return String(text || "")
      .replace(/\.\.\.+/g, "……")
      .replace(/\s*([，。！？；：])\s*/g, "$1")
      .replace(/([。！？])\1+/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/([^。！？…])$/, "$1。");
  }

  function processSpeakQueue() {
    if (isSpeaking) return;
    if (speakQueue.length === 0) {
      releaseVideo();
      return;
    }

    const text = speakQueue.shift();
    const token = speakToken;
    isSpeaking = true;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = settings.speechRate;
    utterance.pitch = 1;
    if (bestVoice) utterance.voice = bestVoice;

    const finish = () => {
      if (token !== speakToken) return;
      isSpeaking = false;
      processSpeakQueue();
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    speechSynthesis.speak(utterance);
  }

  function speak(text) {
    if (!settings.ttsEnabled) return;
    const preparedText = prepareSpeechText(text);
    if (!preparedText) return;

    speakQueue.push(preparedText);
    const video = document.querySelector("video");
    if (video && !video.paused && !heldVideo) {
      heldVideo = video;
      video.pause();
    }
    processSpeakQueue();
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
  let lastLiveTranslatedSourceText = "";
  let lastLiveTranslatedText = "";
  let lastLiveSpokenText = "";
  let liveTranslateInFlight = false;
  let lastLiveTranslationStartedAt = 0;
  let liveTranslationRetryAt = 0;
  let activeSourceLanguage = "unknown";
  let liveSnapshot = "";
  let liveSnapshotAt = 0;
  let livePendingSince = 0;
  let liveConsumed = "";
  let liveGeneration = 0;
  const LIVE_TRANSLATION_INTERVAL_MS = 1200;
  const LIVE_TRANSLATION_BACKOFF_MS = 10000;
  const LIVE_CAPTION_SETTLE_MS = 900;
  const LIVE_CAPTION_MAX_WAIT_MS = 1800;

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
    lastLiveTranslatedSourceText = "";
    lastLiveTranslatedText = "";
    lastLiveSpokenText = "";
    liveTranslateInFlight = false;
    lastLiveTranslationStartedAt = 0;
    liveTranslationRetryAt = 0;
    liveSnapshot = "";
    livePendingSince = 0;
    liveConsumed = "";
    captionRequestsRateLimited = false;
    liveGeneration++;
    captionCues = [];
    translatedCues = [];
    lastSpokenIndex = -1;
    if (typeof YTChineseHelper.clearTranslationCache !== "function") {
      throw new Error("Translation adapter is not loaded");
    }
    YTChineseHelper.clearTranslationCache();
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
    activeSourceLanguage = YTChineseHelper.normalizeLanguageCode(bestTrack.languageCode);
    console.log("[YouTube中文助手] 使用字幕轨道:", bestTrack.languageCode, bestTrack.kind || "manual");

    const rankedTracks = rankCaptionTracks(tracks);
    let sourceTrack = bestTrack;
    let youtubeTranslatedCues = [];
    for (const track of rankedTracks) {
      youtubeTranslatedCues = await fetchCaptions(track, { translate: true });
      if (youtubeTranslatedCues.length > 0) {
        sourceTrack = track;
        activeSourceLanguage = YTChineseHelper.normalizeLanguageCode(sourceTrack.languageCode);
        break;
      }
    }
    if (youtubeTranslatedCues.length > 0) {
      translatedCues = youtubeTranslatedCues.map((cue) => ({
        ...cue,
        translated: cue.text,
        translationStatus: "translated",
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
        activeSourceLanguage = YTChineseHelper.normalizeLanguageCode(sourceTrack.languageCode);
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
      console.info("[YouTube中文助手] 字幕文件不可直接读取，已切换实时字幕模式");
      return;
    }

    showOverlay("正在翻译字幕...");
    translatedCues = await translateBatch(captionCues, sourceTrack.languageCode);
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
    const visibleNodes = nodes.filter((node) => {
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    return normalizeCaptionText(visibleNodes.map((node) => node.textContent || "").join(" "));
  }

  function normalizeCaptionText(text) {
    return text
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function pollLiveCaption() {
    const snapshot = getVisibleYouTubeCaptionText();
    const now = Date.now();
    if (snapshot !== liveSnapshot) {
      liveSnapshot = snapshot;
      liveSnapshotAt = now;
    }
    const text = YTChineseHelperCore.newCaptionText(liveConsumed, snapshot);
    if (!text) {
      livePendingSince = 0;
      if (!lastLiveCaptionText) showOverlay("请开启 YouTube 原字幕");
      return;
    }
    if (!livePendingSince) livePendingSince = now;
    if (!YTChineseHelperCore.shouldFlushLiveCaption(
      now,
      liveSnapshotAt,
      livePendingSince,
      LIVE_CAPTION_SETTLE_MS,
      LIVE_CAPTION_MAX_WAIT_MS
    )) return;

    if (text !== lastLiveCaptionText) {
      lastLiveCaptionText = text;
    }
    if (text === lastLiveTranslatedSourceText) {
      if (lastLiveTranslatedText) showOverlay(lastLiveTranslatedText);
      return;
    }

    if (
      liveTranslateInFlight ||
      now - lastLiveTranslationStartedAt < LIVE_TRANSLATION_INTERVAL_MS ||
      now < liveTranslationRetryAt
    ) {
      return;
    }

    liveTranslateInFlight = true;
    const generation = liveGeneration;
    lastLiveTranslationStartedAt = now;
    try {
      const result = await translate(text, activeSourceLanguage);
      if (generation !== liveGeneration) return;
      if (result.status === "translated") {
        liveConsumed = snapshot;
        livePendingSince = 0;
        liveTranslationRetryAt = 0;
        lastLiveTranslatedSourceText = text;
        lastLiveTranslatedText = result.text;
        showOverlay(result.text);
      } else {
        const code = result.error?.code || "UNKNOWN_ERROR";
        const message = result.error?.message || "Unknown translation error";
        const rateLimited = /HTTP 429/i.test(message);
        if (rateLimited) {
          liveTranslationRetryAt = Date.now() + LIVE_TRANSLATION_BACKOFF_MS;
          showOverlay("翻译请求过快，稍后自动恢复");
        } else {
          lastLiveTranslatedSourceText = text;
          lastLiveTranslatedText = "";
          showOverlay("翻译暂时不可用");
        }
        console.warn(
          `[YouTube中文助手] 实时字幕翻译失败 [${code}] ${message} ` +
            `(source=${activeSourceLanguage}, length=${text.length})`
        );
      }
      if (
        settings.ttsEnabled &&
        result.status === "translated" &&
        text !== lastLiveSpokenText
      ) {
        lastLiveSpokenText = text;
        speak(result.text);
      }
    } finally {
      if (generation === liveGeneration) liveTranslateInFlight = false;
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
    const video = document.querySelector("video");
    if (!video || video.seeking || (video.paused && video !== heldVideo)) return;

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
        if (settings.ttsEnabled && cue.translationStatus === "translated") {
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
    liveGeneration++;
    liveTranslateInFlight = false;
    releaseVideo();
  }

  document.addEventListener("seeking", (event) => {
    if (event.target.tagName !== "VIDEO") return;
    heldVideo = null;
    speechSynthesis.cancel();
    speakQueue = [];
    isSpeaking = false;
    speakToken++;
    liveGeneration++;
    liveTranslateInFlight = false;
    liveSnapshot = "";
    livePendingSince = 0;
    liveConsumed = "";
    lastLiveTranslatedSourceText = "";
    lastLiveSpokenText = "";
    lastSpokenIndex = -1;
  }, true);

  document.addEventListener("pause", (event) => {
    if (event.target.tagName === "VIDEO" && event.target !== heldVideo) speechSynthesis.pause();
  }, true);
  document.addEventListener("play", (event) => {
    if (event.target.tagName === "VIDEO") speechSynthesis.resume();
  }, true);

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
