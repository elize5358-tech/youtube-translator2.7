const defaults = {
  translateEnabled: true,
  ttsEnabled: true,
  speechRate: 1.0,
};

const translateToggle = document.getElementById("translateToggle");
const ttsToggle = document.getElementById("ttsToggle");
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");

// Load settings
chrome.storage.local.get(defaults, (res) => {
  translateToggle.checked = res.translateEnabled;
  ttsToggle.checked = res.ttsEnabled;
  speedSlider.value = res.speechRate;
  speedValue.textContent = res.speechRate.toFixed(1) + "x";
});

// Save on change
translateToggle.addEventListener("change", () => {
  chrome.storage.local.set({ translateEnabled: translateToggle.checked });
});

ttsToggle.addEventListener("change", () => {
  chrome.storage.local.set({ ttsEnabled: ttsToggle.checked });
});

speedSlider.addEventListener("input", () => {
  const rate = parseFloat(speedSlider.value);
  speedValue.textContent = rate.toFixed(1) + "x";
  chrome.storage.local.set({ speechRate: rate });
});
