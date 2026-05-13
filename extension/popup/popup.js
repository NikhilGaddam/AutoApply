async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

(async () => {
  const tab = await getActiveTab();
  try {
    document.getElementById("site").textContent = new URL(tab.url).hostname;
  } catch (_) {}

  document.getElementById("fill").addEventListener("click", async () => {
    const status = document.getElementById("status");
    status.textContent = "Filling…";
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "autoapply.fill" });
      if (res?.ok) {
        status.textContent = `Filled ${res.filled} · ${res.unmapped} need review (${res.site})`;
      } else {
        status.textContent = res?.error || "Failed to fill.";
      }
    } catch (e) {
      status.textContent = "Open an application page first.";
    }
  });

  document.getElementById("clear").addEventListener("click", async () => {
    try { await chrome.tabs.sendMessage(tab.id, { type: "autoapply.clear" }); } catch (_) {}
  });

  document.getElementById("options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
})();
