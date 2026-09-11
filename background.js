function isAllowedCaptionUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const isYouTube = url.hostname === "www.youtube.com";
    const isGoogleVideo = url.hostname.endsWith(".googlevideo.com");
    return (
      url.protocol === "https:" &&
      (isYouTube || isGoogleVideo) &&
      url.pathname === "/api/timedtext"
    );
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FETCH_YOUTUBE_CAPTIONS") return false;

  if (!isAllowedCaptionUrl(message.url)) {
    sendResponse({ ok: false, status: 0, body: "", error: "Caption URL is not allowed" });
    return false;
  }

  fetch(message.url, {
    credentials: "include",
    cache: "no-store",
    redirect: "follow",
  })
    .then(async (response) => {
      sendResponse({
        ok: response.ok,
        status: response.status,
        body: await response.text(),
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        status: 0,
        body: "",
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});
