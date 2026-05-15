// AutoApply content script entrypoint.
// Loads the user's profile from storage (or defaults), picks a site handler,
// fills the form, and shows the review overlay.
(function () {
  const ns = window.AutoApply;
  if (!ns) return;

  const STORAGE_KEY = "autoapply.profile";
  const FOUNDRY_KEY = "autoapply.foundry";

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

  function setAiStatus(text, tone = "info") {
    let el = document.querySelector(".autoapply-ai-status");
    if (!el) {
      el = document.createElement("div");
      el.className = "autoapply-ai-status";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.setAttribute("data-tone", tone);
    document.documentElement.setAttribute("data-autoapply-ai-status", text);
  }

  function cleanText(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button, svg, ul, ol, option").forEach(n => n.remove());
    return (clone.innerText || clone.textContent || "").replace(/[*✱]/g, " ").replace(/\s+/g, " ").trim();
  }

  function fieldLabel(el) {
    if (!el) return "";
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text = cleanText(lbl);
      if (text) return text;
    }
    const labelledBy = el.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => cleanText(document.getElementById(id))).filter(Boolean).join(" ");
      if (text) return text;
    }
    const wrapper = el.closest?.(".application-question, .form-group, .field, fieldset, .select, .select__container");
    const wrapperLabel = wrapper?.querySelector?.(":scope > label, :scope > legend, :scope > .label, :scope > .select__label, :scope > .application-label");
    const text = cleanText(wrapperLabel);
    if (text) return text;
    return (el.getAttribute?.("placeholder") || el.name || el.id || "").replace(/\s+/g, " ").trim();
  }

  function hasValue(el) {
    if (!el) return false;
    if ((el.type || "").toLowerCase() === "file") return !!el.files?.length;
    const selectRoot = el.closest?.(".select__container, .select");
    const selected = selectRoot?.querySelector?.("[class*='single-value']")?.textContent?.trim();
    if (selected && !/^select\.\.\.$/i.test(selected)) return true;
    return !!String(el.value || "").trim();
  }

  function requiredText(el) {
    const parts = [];
    if (el?.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) parts.push(lbl.innerText || lbl.textContent || "");
    }
    const labelledBy = el?.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach(id => {
        const node = document.getElementById(id);
        if (node) parts.push(node.innerText || node.textContent || "");
      });
    }
    const wrapper = el?.closest?.(".application-question, .form-group, .field, fieldset, .select, .select__container");
    if (wrapper) parts.push(wrapper.innerText || wrapper.textContent || "");
    return parts.join(" ");
  }

  function isRequired(el) {
    if (!el || el.name === "g-recaptcha-response" || /^g-recaptcha-response/.test(el.id || "")) return false;
    return el.required || el.getAttribute?.("aria-required") === "true" || /\*/.test(requiredText(el));
  }

  function requiredMissingItems(result) {
    const seen = new Set();
    const items = [];
    const add = (el) => {
      if (!isRequired(el) || hasValue(el)) return;
      const label = fieldLabel(el);
      if (!label) return;
      const key = label.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return;
      seen.add(key);
      const selectRoot = el.closest?.(".select__container, .select");
      const options = selectRoot
        ? Array.from(selectRoot.querySelectorAll("[class*='select__option']")).map(o => o.textContent.trim()).filter(Boolean)
        : [];
      items.push({ el, id: el.id || "", name: el.name || "", label, type: el.type || el.tagName.toLowerCase(), options });
    };
    (result.unmapped || []).forEach(add);
    (result.skipped || []).forEach(item => add(item.el));
    return items;
  }

  async function fillAiAnswer(field, value) {
    if (!field?.el || value == null || value === "") return false;
    const el = field.el;
    if (el.classList?.contains("select__input") && el.id) {
      const targets = (ns.FormFiller.expandSynonyms || (v => [v]))(String(value).toLowerCase().trim());
      const resp = await chrome.runtime.sendMessage({ type: "ghSelectOption", inputId: el.id, targets });
      return !!resp?.ok;
    }
    return ns.FormFiller.fillField(el, value);
  }

  function parseClaudeAgentJson(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch (_) {}
    }
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try { return JSON.parse(raw.slice(first, last + 1)); } catch (_) {}
    }
    return null;
  }

  function normalizeFoundryConfig(raw = {}) {
    return {
      apiKey: raw.apiKey || raw.api_key || raw.key || raw.ANTHROPIC_FOUNDRY_API_KEY || "",
      resource: raw.resource || raw.endpoint || raw.url || raw.ANTHROPIC_FOUNDRY_RESOURCE || "",
      baseUrl: raw.baseUrl || raw.base_url || raw.ANTHROPIC_FOUNDRY_BASE_URL || "",
      model: normalizeClaudeModel(raw.model || raw.claudeModel || raw.ANTHROPIC_DEFAULT_OPUS_MODEL || raw.ANTHROPIC_MODEL)
    };
  }

  function normalizeClaudeModel(model) {
    const value = String(model || "sonnet").trim();
    if (value === "opus-4-6") return "claude-opus-4-6";
    if (value === "opus-4-7") return "claude-opus-4-7";
    return value || "sonnet";
  }

  function missingFoundrySettings(cfg) {
    return [
      ["API key", cfg.apiKey],
      ["Resource", cfg.resource],
      ["Claude model", cfg.model]
    ].filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  }

  function foundryRequestUrls(resource, baseUrl = "") {
    const raw = String(resource || "").trim();
    const base = String(baseUrl || "").trim();
    const urls = [];
    if (base) {
      try {
        const baseEndpoint = new URL(base);
        const basePath = baseEndpoint.pathname.replace(/\/+$/, "");
        baseEndpoint.pathname = /\/models\/chat\/completions$/i.test(basePath)
          ? basePath
          : `${basePath || ""}/models/chat/completions`.replace(/\/+/g, "/");
        if (!baseEndpoint.searchParams.has("api-version")) baseEndpoint.searchParams.set("api-version", "2024-05-01-preview");
        urls.push(baseEndpoint.toString());
      } catch (_) {}
    }
    if (/^[a-z0-9-]+$/i.test(raw)) {
      urls.push(`https://${raw}.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview`);
      return Array.from(new Set(urls));
    }
    try {
      const url = new URL(raw);
      const path = url.pathname.replace(/\/+$/, "");
      if (/\/(v1\/messages|messages|chat\/completions)$/i.test(path)) return Array.from(new Set([...urls, url.toString()]));
      const messagesUrl = new URL(url.toString());
      messagesUrl.pathname = /\/v1$/i.test(path) ? `${path}/messages` : `${path || ""}/v1/messages`.replace(/\/+/g, "/");
      urls.push(messagesUrl.toString(), url.toString());
      return Array.from(new Set(urls));
    } catch (_) {
      if (raw) urls.push(raw);
      return Array.from(new Set(urls));
    }
  }

  async function fetchClaudeMessages(urls, cfg, body, logs = []) {
    let lastError = null;
    for (const url of urls) {
      try {
        const endpoint = new URL(url);
        logs.push(`Calling Foundry endpoint ${endpoint.origin}${endpoint.pathname}.`);
      } catch (_) {
        logs.push("Calling Foundry resource from saved settings.");
      }
      let res;
      try {
        res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "api-key": cfg.apiKey,
          "authorization": `Bearer ${cfg.apiKey}`,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body)
        });
      } catch (e) {
        let origin = "saved Foundry endpoint";
        try { origin = new URL(url).origin; } catch (_) {}
        lastError = `${e.message || String(e)} (${origin})`;
        logs.push(`Foundry endpoint fetch failed: ${e.message || String(e)}.`);
        continue;
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      lastError = json.error?.message || json.message || `Foundry request failed: ${res.status}`;
      logs.push(`Foundry endpoint returned ${res.status}.`);
      if (![404, 405].includes(res.status)) break;
    }
    throw new Error(lastError || "Foundry request failed.");
  }

  async function runClaudeAgentInContent(payload, logs = []) {
    const stored = await chrome.storage.sync.get(FOUNDRY_KEY);
    const cfg = normalizeFoundryConfig(stored?.[FOUNDRY_KEY] || {});
    const missing = missingFoundrySettings(cfg);
    if (missing.length) {
      logs.push(`Foundry settings check failed: missing ${missing.join(", ")}.`);
      throw new Error(`Foundry settings are missing in the extension popup: ${missing.join(", ")}.`);
    }

    const model = cfg.model;
    logs.push(`Using Claude SDK Agent contract with model ${model}.`);
    const agentTask = {
      agent: "AutoApply Claude SDK Agent",
      objective: "Fill only required missing job application fields and then return control to the human.",
      instructions: [
        "Use only the provided profile JSON, resume/details text, and page context.",
        "Create field-fill actions only for fields you can answer confidently from the supplied data.",
        "For yes/no fields, answer with Yes or No.",
        "Do not submit the application.",
        "Return strict JSON only."
      ],
      outputSchema: { actions: [{ type: "fill", id: "field id", label: "field label", value: "answer" }], handoff: "Hand over to Human" },
      missingRequiredFields: payload.fields || [],
      profile: payload.profile || {},
      resumeText: payload.resumeText || "",
      page: payload.page || {}
    };

    const json = await fetchClaudeMessages(foundryRequestUrls(cfg.resource, cfg.baseUrl), cfg, {
      model,
      max_tokens: 1200,
      max_completion_tokens: 1200,
      temperature: 0,
      messages: [{ role: "user", content: `You are AutoApply Claude SDK Agent. Run this agent task and return only JSON.\n\n${JSON.stringify(agentTask, null, 2)}` }]
    }, logs);
    const text = json.content?.map?.(part => part.text || "").join("\n") || json.choices?.[0]?.message?.content || json.output_text || json.text || "";
    const parsed = parseClaudeAgentJson(text) || json;
    const actions = Array.isArray(parsed.actions) ? parsed.actions :
                    Array.isArray(parsed.answers) ? parsed.answers.map(a => ({ type: "fill", ...a })) : [];
    logs.push(`Claude agent returned ${actions.length} action${actions.length === 1 ? "" : "s"}.`);
    return { ok: true, actions, handoff: parsed.handoff || "Hand over to Human" };
  }

  async function handOverMissingFieldsToAi(profile, result) {
    const missing = requiredMissingItems(result);
    if (!missing.length) return { attempted: false, filled: 0, missing, logs: [] };
    const logs = [];
    logs.push(`Found ${missing.length} required missing field${missing.length === 1 ? "" : "s"}.`);
    missing.forEach(item => logs.push(`Missing: ${item.label}`));
    setAiStatus("Taken Over by AI", "working");
    logs.push("Status set to Taken Over by AI.");

    const payload = {
      profile,
      resumeText: profile.resumeText || profile.resumeSummary || "",
      page: { url: location.href, title: document.title, formText: (document.querySelector("form")?.innerText || "").slice(0, 6000) },
      fields: missing.map(({ id, name, label, type, options }) => ({ id, name, label, type, options }))
    };
    const resp = await new Promise(resolve => {
      logs.push("Sending missing-field task to Claude agent via background service worker.");
      chrome.runtime.sendMessage({ type: "claudeAgent.fillMissingFields", payload }, response => {
        if (chrome.runtime.lastError) {
          logs.push(`Background handoff failed: ${chrome.runtime.lastError.message}`);
          logs.push("Retrying Claude agent handoff from the content script.");
          runClaudeAgentInContent(payload, logs)
            .then(resolve)
            .catch(e => resolve({ ok: false, error: e.message || chrome.runtime.lastError.message }));
          return;
        }
        logs.push("Background service worker returned an AI handoff response.");
        (response?.logs || []).forEach(line => logs.push(`Background: ${line}`));
        resolve(response || { ok: false, error: "AI handoff returned no response." });
      });
    });
    if (!resp?.ok) {
      logs.push(`AI handoff failed: ${resp?.error || "AI handoff failed"}`);
      setAiStatus(`Hand over to Human - ${resp?.error || "AI handoff failed"}`, "error");
      return { attempted: true, filled: 0, missing, error: resp?.error || "AI handoff failed", status: `Hand over to Human - ${resp?.error || "AI handoff failed"}`, logs };
    }

    let filled = 0;
    for (const action of resp.actions || resp.answers || []) {
      if (action.type && action.type !== "fill") continue;
      const field = missing.find(item => item.id && item.id === action.id) ||
                    missing.find(item => item.label === action.label) ||
                    missing.find(item => item.label.toLowerCase() === String(action.label || "").toLowerCase());
      if (field && await fillAiAnswer(field, action.value)) {
        filled += 1;
        logs.push(`Filled: ${field.label}`);
      } else {
        logs.push(`Skipped AI action: ${action.label || action.id || "unknown field"}`);
      }
    }
    const status = resp.handoff || "Hand over to Human";
    logs.push(`Status set to ${status}.`);
    setAiStatus(status, "done");
    return { attempted: true, filled, missing: requiredMissingItems(result), status, logs };
  }

  async function run() {
    const profile = await loadProfile();
    const url = new URL(window.location.href);
    const Handler = ns.SiteRegistry.pickHandler(url);
    const site = new Handler(profile);
    ns.Overlay.clearMarks();
    const result = await site.fill();
    result.ai = await handOverMissingFieldsToAi(profile, result).catch(e => {
      setAiStatus(`Hand over to Human - ${e.message}`, "error");
      return { attempted: true, filled: 0, error: e.message, missing: requiredMissingItems(result) };
    });
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

  function missingFieldNames(result) {
    return requiredMissingItems(result).map(item => item.label.slice(0, 90));
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
        site: r.site,
        missingFields: missingFieldNames(r),
        aiStatus: document.documentElement.getAttribute("data-autoapply-ai-status") || null,
        aiFilled: r.ai?.filled || 0,
        aiError: r.ai?.error || null
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
