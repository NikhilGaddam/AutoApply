// Background service worker. On first install, seed the default profile.

// Fill an input in the page's MAIN world (bypasses isolated-world React
// tracker issues). Content scripts send this message when the normal
// isolated-world fill doesn't notify React's own-property tracker.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fillFieldMainWorld" && sender.tab?.id) {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: (selector, value) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        el.focus();
        // Direct assignment calls React's own-property tracker (the correct
        // setter in page world). Do NOT blur — blur triggers React's
        // cross-field password-match validation before the other field is set,
        // which can clear this field.
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === value;
      },
      args: [msg.selector, msg.value]
    })
      .then(results => sendResponse({ ok: true, result: results?.[0]?.result }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // keep channel open for async response
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.sync.get("autoapply.profile");
    if (!stored || !stored["autoapply.profile"]) {
      // Inline a minimal default : full default lives in data/defaultProfile.js for content script use.
      // Here we just open the options page so the user can review.
      chrome.runtime.openOptionsPage?.();
    }
  } catch (e) { console.warn(e); }
});
