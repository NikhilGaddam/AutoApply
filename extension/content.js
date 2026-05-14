// AutoApply content script entrypoint.
// Loads the user's profile from storage (or defaults), picks a site handler,
// fills the form, and shows the review overlay.
(function () {
  const ns = window.AutoApply;
  if (!ns) return;

  const STORAGE_KEY = "autoapply.profile";

  // Deep-merge stored profile over defaults so newly-added keys (e.g. demographics)
  // are always present even if the user's saved profile predates them.
  function deepMerge(target, source) {
    if (source == null || typeof source !== "object" || Array.isArray(source)) return source ?? target;
    const out = Array.isArray(target) ? [] : { ...(target || {}) };
    for (const k of Object.keys(source)) {
      const sv = source[k];
      const tv = out[k];
      if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
        out[k] = deepMerge(tv, sv);
      } else {
        out[k] = sv;
      }
    }
    return out;
  }

  async function loadProfile() {
    try {
      const stored = await chrome.storage.sync.get(STORAGE_KEY);
      if (stored && stored[STORAGE_KEY]) {
        return deepMerge(ns.DEFAULT_PROFILE, stored[STORAGE_KEY]);
      }
    } catch (_) {}
    return ns.DEFAULT_PROFILE;
  }

  async function trySubmit() {
    // Don't actually click : let the user verify visually first. Highlight,
    // scroll to, and focus the submit button.
    ns.Overlay.focusSubmit();
  }

  async function run() {
    const profile = await loadProfile();
    const url = new URL(window.location.href);
    const Handler = ns.SiteRegistry.pickHandler(url);
    const site = new Handler(profile);
    ns.Overlay.clearMarks();
    const result = await site.fill();
    ns.Overlay.markFilled(result.filled.map((f) => f.el));
    ns.Overlay.markUnmapped(result.unmapped);
    ns.Overlay.highlightSubmit();
    ns.Overlay.showReview({
      ...result,
      site: Handler.label,
      onSubmit: trySubmit,
      onCancel: (reason) => { if (reason === "rescan") run(); }
    });
    return result;
  }

  // Quietly re-fill any newly added question wrappers (e.g. demographic survey
  // sections that load lazily) without re-rendering the overlay each time.
  async function quietFill() {
    try {
      const profile = await loadProfile();
      const url = new URL(window.location.href);
      const Handler = ns.SiteRegistry.pickHandler(url);
      const site = new Handler(profile);
      const result = await site.fill();
      ns.Overlay.markFilled(result.filled.map((f) => f.el));
      return result;
    } catch (e) { console.warn("AutoApply quietFill:", e); }
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
    if (msg.type === "autoapply.status") {
      const d = document.documentElement;
      const ss = {};
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith("aa_")) ss[k] = sessionStorage.getItem(k);
        }
      } catch (_) {}
      const tickRaw = d.getAttribute("data-autoapply-tick");
      sendResponse({
        ok: true,
        step: d.getAttribute("data-autoapply-step") || null,
        authState: d.getAttribute("data-autoapply-auth") || null,
        tickAge: tickRaw ? Date.now() - parseInt(tickRaw, 10) : null,
        paused: !!window.__autoApplyWorkdayPaused,
        isWorkday: /\.myworkdayjobs\.com$|\.workday\.com$/.test(window.location.hostname),
        ss
      });
      return true;
    }
    if (msg.type === "autoapply.pause") {
      window.__autoApplyWorkdayPaused = true;
      document.documentElement.setAttribute("data-autoapply-auth",
        document.documentElement.getAttribute("data-autoapply-auth") + ":paused");
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "autoapply.resume") {
      window.__autoApplyWorkdayPaused = false;
      // Restart the driver if the budget-kill stopped it.
      if (!window.__autoApplyWorkdayDriver) {
        loadProfile().then((profile) => {
          const url = new URL(window.location.href);
          const Handler = ns.SiteRegistry.pickHandler(url);
          const site = new Handler(profile);
          site._ensureDriver();
        });
      }
      sendResponse({ ok: true });
      return true;
    }
  });

  // Auto-detect: only run automatically if the page looks like an application form.
  function looksLikeApplicationForm() {
    const url = window.location.href.toLowerCase();
    if (/\/apply(\b|\/|\?|$)/.test(url)) return true;
    if (/application/.test(url)) return true;
    // Workday redirects /apply -> /login?redirect=...%2Fapply... before the
    // user authenticates. Treat any Workday host as an application context
    // so the WorkdaySite driver can drive the auth gate.
    if (/\.myworkdayjobs\.com$|\.workday\.com$/.test(window.location.hostname)) return true;
    const form = document.querySelector("form");
    if (!form) return false;
    const text = (form.innerText || "").toLowerCase();
    return /resume|cv|first name|full name|cover letter/.test(text);
  }

  if (looksLikeApplicationForm()) {
    // Delay slightly to let SPA forms (Workday/Greenhouse) finish rendering.
    setTimeout(() => { run().catch(console.error); }, 800);

    // Watch for lazy-loaded question wrappers (Lever's demographic survey
    // section, multi-step Workday/Tesla pages, etc.). For brand-new form
    // sections (e.g. Tesla step 2) we re-run the full flow so the toast
    // reflects the new step; for incremental additions a quiet fill suffices.
    const QUESTION_SEL = "li.application-question, .application-question, fieldset.form-group, .tds-form-item, .tds-form-fieldset, .tds-form-input-group";
    let pending = false;
    let lastFieldCount = document.querySelectorAll("form input[name], form select[name], form textarea[name]").length;
    const observer = new MutationObserver((mutations) => {
      let hasNew = false;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.(QUESTION_SEL) || node.querySelector?.(QUESTION_SEL)) {
            hasNew = true; break;
          }
        }
        if (hasNew) break;
      }
      if (!hasNew || pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        const now = document.querySelectorAll("form input[name], form select[name], form textarea[name]").length;
        // Heuristic: if the set of named fields changed substantially (e.g.
        // a multi-step navigation replaced the form), do a full run() so the
        // user gets a fresh toast & submit-button highlight; otherwise just
        // quietly fill any newly-revealed widgets.
        if (Math.abs(now - lastFieldCount) >= 3) {
          lastFieldCount = now;
          run().catch(console.error);
        } else {
          lastFieldCount = now;
          quietFill();
        }
      }, 600);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Stop observing after 5 min : long enough to cover realistic multi-step
    // application flows (Tesla, Workday) without running indefinitely.
    setTimeout(() => observer.disconnect(), 5 * 60 * 1000);
  }
})();
