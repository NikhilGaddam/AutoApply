// AutoApply content script entrypoint.
// Loads the user's profile from storage (or defaults), picks a site handler,
// fills the form, and shows the review overlay.
(function () {
  const ns = window.AutoApply;
  if (!ns) return;

  const STORAGE_KEY = "autoapply.profile";

  async function loadProfile() {
    try {
      const stored = await chrome.storage.sync.get(STORAGE_KEY);
      if (stored && stored[STORAGE_KEY]) return stored[STORAGE_KEY];
    } catch (_) {}
    return ns.DEFAULT_PROFILE;
  }

  async function trySubmit() {
    // Try to click the form's submit button. Don't actually submit programmatically
    // — let the user verify visually first by focusing the button.
    const btn = document.querySelector(
      "form#application-form button[type='submit'], form button[type='submit'], button[type='submit'], input[type='submit']"
    );
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      btn.focus();
    }
  }

  async function run() {
    const profile = await loadProfile();
    const url = new URL(window.location.href);
    const Handler = ns.SiteRegistry.pickHandler(url);
    const site = new Handler(profile);
    ns.Overlay.clearMarks();
    const result = site.fill();
    ns.Overlay.markFilled(result.filled.map((f) => f.el));
    ns.Overlay.markUnmapped(result.unmapped);
    ns.Overlay.showReview({
      ...result,
      site: Handler.label,
      onSubmit: trySubmit,
      onCancel: (reason) => { if (reason === "rescan") run(); }
    });
    return result;
  }

  // Message API used by popup
  chrome.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "autoapply.fill") {
      run().then((r) => sendResponse({
        ok: true,
        filled: r.filled.length,
        unmapped: r.unmapped.length,
        skipped: r.skipped.length,
        site: r.site
      })).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg.type === "autoapply.clear") {
      ns.Overlay.clearMarks();
      document.querySelectorAll(".autoapply-toast").forEach((n) => n.remove());
      sendResponse({ ok: true });
      return true;
    }
  });

  // Auto-detect: only run automatically if the page looks like an application form.
  function looksLikeApplicationForm() {
    const url = window.location.href.toLowerCase();
    if (/\/apply(\b|\/|\?|$)/.test(url)) return true;
    if (/application/.test(url)) return true;
    const form = document.querySelector("form");
    if (!form) return false;
    const text = (form.innerText || "").toLowerCase();
    return /resume|cv|first name|full name|cover letter/.test(text);
  }

  if (looksLikeApplicationForm()) {
    // Delay slightly to let SPA forms (Workday/Greenhouse) finish rendering.
    setTimeout(() => { run().catch(console.error); }, 800);
  }
})();
