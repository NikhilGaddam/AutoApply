const STORAGE_KEY = "autoapply.profile";
const ta = document.getElementById("json");
const status = document.getElementById("status");

function setStatus(msg, color = "#16a34a") {
  status.textContent = msg;
  status.style.color = color;
  setTimeout(() => { status.textContent = ""; }, 2500);
}

async function load() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  const profile = stored[STORAGE_KEY] || window.AutoApply.DEFAULT_PROFILE;
  ta.value = JSON.stringify(profile, null, 2);
}

document.getElementById("save").addEventListener("click", async () => {
  try {
    const parsed = JSON.parse(ta.value);
    await chrome.storage.sync.set({ [STORAGE_KEY]: parsed });
    setStatus("Saved ✓");
  } catch (e) {
    setStatus("Invalid JSON: " + e.message, "#b91c1c");
  }
});

document.getElementById("reset").addEventListener("click", async () => {
  ta.value = JSON.stringify(window.AutoApply.DEFAULT_PROFILE, null, 2);
  await chrome.storage.sync.set({ [STORAGE_KEY]: window.AutoApply.DEFAULT_PROFILE });
  setStatus("Reset to defaults ✓");
});

load();
