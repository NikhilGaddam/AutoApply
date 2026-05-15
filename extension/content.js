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

  function pickHandlerForPage(url) {
    let Handler = ns.SiteRegistry.pickHandler(url);
    if (Handler === ns.GenericSite && ns.GreenhouseSite && document.querySelector("#application-form, .application-question, input#first_name, input#last_name, input#email")) {
      Handler = ns.GreenhouseSite;
    }
    return Handler;
  }

  function hasApplicationSurface() {
    if (document.querySelector("#application-form, .application-question, input#first_name, input#last_name, input#email")) return true;
    const fields = Array.from(document.querySelectorAll("input, textarea, select")).filter(el => {
      const type = (el.type || "").toLowerCase();
      if (["hidden", "submit", "button"].includes(type)) return false;
      if (el.name === "g-recaptcha-response" || /^g-recaptcha-response/.test(el.id || "")) return false;
      return !!(el.offsetParent || el.getClientRects().length);
    });
    return fields.length >= 3;
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
    ns.Overlay.updateAi?.({ status: text, tone });
    document.documentElement.setAttribute("data-autoapply-ai-status", text);
  }

  function summarizeAiValue(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "empty value";
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }
  function appendAiLog(logs, line) {
    logs.push(line);
    ns.Overlay.updateAi?.({ status: "Taken Over by AI", tone: "working", appendLog: line });
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
    if (el.dataset?.autoapplyAiFilled === "true") return true;
    if ((el.type || "").toLowerCase() === "file") return !!el.files?.length;
    if (["checkbox", "radio"].includes((el.type || "").toLowerCase())) return !!el.checked;
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
      const item = fieldItem(el, result, "required");
      if (!item || seen.has(item.key)) return;
      seen.add(item.key);
      items.push(item);
    };
    (result.unmapped || []).forEach(add);
    (result.skipped || []).forEach(item => add(item.el));
    return items;
  }

  function fieldItem(el, result, reason = "review") {
    if (!el || hasValue(el)) return null;
    const label = fieldLabel(el);
    if (!label) return null;
    const key = label.toLowerCase().replace(/\s+/g, " ").trim();
    if (result._autoapplyAiResolvedLabels?.has(key)) return null;
    const selectRoot = el.closest?.(".select__container, .select") || el.closest?.(".application-question, .form-group, .field, fieldset")?.querySelector?.(".select__container, .select");
    const options = selectRoot
      ? Array.from(selectRoot.querySelectorAll("[class*='select__option']")).map(o => o.textContent.trim()).filter(Boolean)
      : [];
    return { el, id: el.id || "", name: el.name || "", label, key, reason, type: el.type || el.tagName.toLowerCase(), options };
  }

  function isEducationField(el) {
    if (!el || hasValue(el)) return false;
    const text = `${fieldLabel(el)} ${el.id || ""} ${el.name || ""}`.toLowerCase();
    return /\b(school|university|college|institution|degree|discipline|field of study|major|education|graduation)\b/.test(text);
  }

  function isAiSafeReviewField(el) {
    if (!el || hasValue(el)) return false;
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.type || "").toLowerCase();
    if (tag === "input" && ["hidden", "submit", "button", "image", "reset", "file"].includes(type)) return false;
    if (el.name === "g-recaptcha-response" || /^g-recaptcha-response/.test(el.id || "")) return false;
    const text = `${fieldLabel(el)} ${el.id || ""} ${el.name || ""}`.toLowerCase();
    if (/\b(recaptcha|captcha|submit|apply now|send application|marketing|newsletter|sms|text message|opt[- ]?in|terms|privacy policy|personal information policy)\b/.test(text)) return false;
    return !!fieldLabel(el);
  }

  function educationMissingItems(result) {
    const seen = new Set(requiredMissingItems(result).map(item => item.key));
    const items = [];
    const add = (el) => {
      if (!isEducationField(el)) return;
      const item = fieldItem(el, result, "education");
      if (!item || seen.has(item.key)) return;
      seen.add(item.key);
      items.push(item);
    };
    (result.unmapped || []).forEach(add);
    (result.skipped || []).forEach(item => add(item.el));
    return items;
  }

  function reviewFieldItems(result) {
    const seen = new Set([...requiredMissingItems(result), ...educationMissingItems(result)].map(item => item.key));
    const items = [];
    const add = (el) => {
      if (!isAiSafeReviewField(el)) return;
      const item = fieldItem(el, result, "review");
      if (!item || seen.has(item.key)) return;
      seen.add(item.key);
      items.push(item);
    };
    (result.unmapped || []).forEach(add);
    (result.skipped || []).forEach(item => add(item.el));
    return items;
  }

  function aiTargetItems(result) {
    return [...requiredMissingItems(result), ...educationMissingItems(result), ...reviewFieldItems(result)];
  }

  async function fillAiAnswer(field, value) {
    if (!field?.el || value == null || value === "") return false;
    const el = field.el;
    const wrapper = el.closest?.(".application-question, .form-group, .field, fieldset, .select, .select__container") || el.parentElement;
    const selectWrapper = el.closest?.(".select__container, .select") || wrapper?.querySelector?.(".select__container, .select");
    const ghSelectInput = el.classList?.contains("select__input")
      ? el
      : selectWrapper?.querySelector?.("input.select__input[id]");
    if (ghSelectInput?.id) {
      const selectRoot = ghSelectInput.closest?.(".select__container, .select") || wrapper;
      const targets = (ns.FormFiller.expandSynonyms || (v => [v]))(String(value).toLowerCase().trim());
      const before = (selectRoot?.querySelector?.("[class*='single-value']")?.textContent || selectRoot?.innerText || "").trim();
      const resp = await chrome.runtime.sendMessage({ type: "ghSelectOption", inputId: ghSelectInput.id, targets, value: String(value) });
      if (!resp?.ok) return fillGhSelectByTyping(ghSelectInput, value, targets);
      await new Promise(resolve => setTimeout(resolve, 250));
      const selected = (selectRoot?.querySelector?.("[class*='single-value']")?.textContent || "").trim();
      if (selected && !/^select\.\.\.$/i.test(selected)) return true;
      const after = (selectRoot?.innerText || "").trim();
      if (after && after !== before && targets.some(target => after.toLowerCase().includes(target))) return true;
      return fillGhSelectByTyping(ghSelectInput, value, targets);
    }
    return ns.FormFiller.fillField(el, value);
  }

  async function fillGhSelectByTyping(input, value, targets) {
    if (!input || value == null || value === "") return false;
    const selectRoot = input.closest?.(".select__container, .select") || input.parentElement;
    const control = input.closest?.("[class*='control']") || selectRoot;
    const targetList = targets?.length ? targets : [String(value).toLowerCase().trim()];
    const setValue = ns.FormFiller.setNativeValue || ((el, v) => { el.value = v; });
    control?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    control?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    control?.click?.();
    input.focus?.();
    setValue(input, String(value));
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown", code: "ArrowDown", keyCode: 40 }));
    await new Promise(resolve => setTimeout(resolve, 1200));
    const optionSelectors = [
      "[id^='react-select-'][id*='-option-']",
      "[role='option']",
      ".select__option",
      "[class*='option']"
    ].join(",");
    const options = Array.from(document.querySelectorAll(optionSelectors)).filter(option => option.offsetParent || option.getClientRects().length);
    const match = options.find(option => {
      const text = (option.innerText || option.textContent || "").toLowerCase().trim();
      return targetList.some(target => text === target || (target.length >= 3 && text && (text.includes(target) || target.includes(text))));
    }) || options[0];
    if (match) {
      match.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      match.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      match.click?.();
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13 }));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    const selected = (selectRoot?.querySelector?.("[class*='single-value']")?.textContent || "").trim();
    if (selected && !/^select\.\.\.$/i.test(selected)) return true;
    const text = (selectRoot?.innerText || "").toLowerCase();
    return targetList.some(target => text.includes(target));
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
        const anthropicEndpoint = new URL(baseEndpoint.toString());
        anthropicEndpoint.pathname = /\/anthropic\/v1\/messages$/i.test(basePath)
          ? basePath
          : `${basePath || ""}/anthropic/v1/messages`.replace(/\/+/g, "/");
        if (!anthropicEndpoint.searchParams.has("api-version")) anthropicEndpoint.searchParams.set("api-version", "2023-06-01-preview");
        urls.push(anthropicEndpoint.toString());

        const chatEndpoint = new URL(baseEndpoint.toString());
        chatEndpoint.pathname = /\/models\/chat\/completions$/i.test(basePath)
          ? basePath
          : `${basePath || ""}/models/chat/completions`.replace(/\/+/g, "/");
        if (!chatEndpoint.searchParams.has("api-version")) chatEndpoint.searchParams.set("api-version", "2024-05-01-preview");
        urls.push(chatEndpoint.toString());
      } catch (_) {}
    }
    if (/^[a-z0-9-]+$/i.test(raw)) {
      urls.push(`https://${raw}.services.ai.azure.com/anthropic/v1/messages?api-version=2023-06-01-preview`);
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
    try {
        appendAiLog(logs, "Trying local Foundry relay at 127.0.0.1:8765.");
      const relayRes = await fetch("http://127.0.0.1:8765/foundry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls, apiKey: cfg.apiKey, body })
      });
      const relayJson = await relayRes.json().catch(() => ({}));
      if (relayRes.ok) return relayJson;
      lastError = relayJson.error || `Local Foundry relay failed: ${relayRes.status}`;
        appendAiLog(logs, lastError);
    } catch (e) {
        appendAiLog(logs, `Local Foundry relay unavailable: ${e.message || String(e)}.`);
    }

    for (const url of urls) {
      try {
        const endpoint = new URL(url);
          appendAiLog(logs, `Calling Foundry endpoint ${endpoint.origin}${endpoint.pathname}.`);
      } catch (_) {
          appendAiLog(logs, "Calling Foundry resource from saved settings.");
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
          appendAiLog(logs, `Foundry endpoint fetch failed: ${e.message || String(e)}.`);
        continue;
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      lastError = json.error?.message || json.message || `Foundry request failed: ${res.status}`;
        appendAiLog(logs, `Foundry endpoint returned ${res.status}.`);
      if (![404, 405].includes(res.status)) break;
    }
    throw new Error(lastError || "Foundry request failed.");
  }

  async function runClaudeAgentInContent(payload, logs = []) {
    const stored = await chrome.storage.sync.get(FOUNDRY_KEY);
    const cfg = normalizeFoundryConfig(stored?.[FOUNDRY_KEY] || {});
    const missing = missingFoundrySettings(cfg);
    if (missing.length) {
        appendAiLog(logs, `Foundry settings check failed: missing ${missing.join(", ")}.`);
      throw new Error(`Foundry settings are missing in the extension popup: ${missing.join(", ")}.`);
    }

    const model = cfg.model;
      appendAiLog(logs, `Using Claude SDK Agent contract with model ${model}.`);
    const agentTask = {
      agent: "AutoApply Claude SDK Agent",
      objective: "Scan the whole application page and fill every safe, answerable remaining field, then return control to the human.",
      instructions: [
        "Read the full page context and all fieldsToFill before deciding actions.",
        "Use only the provided profile JSON, resume/details text, and page context.",
        "When options are provided for a dropdown, choose one exact option from that list.",
        "For 'How did you hear about this job?' source fields, prefer recruiter, talent acquisition, sourcer, reached out, or contacted options; avoid LinkedIn, job board, or job site options when a recruiter-style option exists.",
        "Create field-fill actions for every safe field you can answer confidently from the supplied data, including optional profile, location, education, employment, work authorization, and screening fields.",
        "Education Details fields such as School, Degree, Discipline, field of study, major, and graduation date must be filled from profile.education when present.",
        "Do not fill recaptcha, file upload, final submit buttons, marketing opt-ins, SMS opt-ins, or fields that require a preference not present in the profile.",
        "For yes/no fields, answer with Yes or No.",
        "Do not submit the application.",
        "Return strict JSON only."
      ],
      outputSchema: { actions: [{ type: "fill", id: "field id", label: "field label", value: "answer" }], handoff: "Hand over to Human" },
      fieldsToFill: payload.fields || [],
      profile: payload.profile || {},
      resumeText: payload.resumeText || "",
      page: payload.page || {}
    };

    const json = await fetchClaudeMessages(foundryRequestUrls(cfg.resource, cfg.baseUrl), cfg, {
      model,
      max_tokens: 1200,
      temperature: 0,
      messages: [{ role: "user", content: `You are AutoApply Claude SDK Agent. Run this agent task and return only JSON.\n\n${JSON.stringify(agentTask, null, 2)}` }]
    }, logs);
    const text = json.content?.map?.(part => part.text || "").join("\n") || json.choices?.[0]?.message?.content || json.output_text || json.text || "";
    const parsed = parseClaudeAgentJson(text) || json;
    const actions = Array.isArray(parsed.actions) ? parsed.actions :
                    Array.isArray(parsed.answers) ? parsed.answers.map(a => ({ type: "fill", ...a })) : [];
      appendAiLog(logs, `Claude agent returned ${actions.length} action${actions.length === 1 ? "" : "s"}.`);
    return { ok: true, actions, handoff: parsed.handoff || "Hand over to Human" };
  }

  async function handOverMissingFieldsToAi(profile, result) {
    const missing = aiTargetItems(result);
    if (!missing.length) return { attempted: false, filled: 0, missing: requiredMissingItems(result), logs: [] };
    const logs = [];
    const log = (line, status, tone = "working") => {
      logs.push(line);
      ns.Overlay.updateAi?.({ status, tone, appendLog: line });
    };
    const requiredCount = missing.filter(item => item.reason === "required").length;
    const educationCount = missing.filter(item => item.reason === "education").length;
    const reviewCount = missing.filter(item => item.reason === "review").length;
    log(`Found ${requiredCount} required missing field${requiredCount === 1 ? "" : "s"}, ${educationCount} Education Details field${educationCount === 1 ? "" : "s"}, and ${reviewCount} safe review field${reviewCount === 1 ? "" : "s"} for AI.`, "Taken Over by AI");
    log("Thinking: scanning the whole page, profile, resume context, required fields, education fields, and safe optional review fields.", "Taken Over by AI");
    missing.forEach(item => log(`Thinking about ${item.reason} field: ${item.label}`, "Taken Over by AI"));
    setAiStatus("Taken Over by AI", "working");
    log("Status set to Taken Over by AI.", "Taken Over by AI");

    log("Preparing the Claude agent task with field labels, IDs, input types, and available options.", "Taken Over by AI");
    const payload = {
      profile,
      resumeText: profile.resumeText || profile.resumeSummary || "",
      page: { url: location.href, title: document.title, formText: (document.querySelector("form")?.innerText || "").slice(0, 6000) },
      fields: missing.map(({ id, name, label, type, options, reason }) => ({ id, name, label, type, options, reason }))
    };
    const resp = await new Promise(resolve => {
      log("Sending missing-field task to Claude agent via background service worker.", "Taken Over by AI");
      chrome.runtime.sendMessage({ type: "claudeAgent.fillMissingFields", payload }, response => {
        if (chrome.runtime.lastError) {
          log(`Background handoff failed: ${chrome.runtime.lastError.message}`, "Taken Over by AI");
          log("Retrying Claude agent handoff from the content script.", "Taken Over by AI");
          runClaudeAgentInContent(payload, logs)
            .then(resolve)
            .catch(e => resolve({ ok: false, error: e.message || chrome.runtime.lastError.message }));
          return;
        }
        log("Background service worker returned an AI handoff response.", "Taken Over by AI");
        (response?.logs || []).forEach(line => log(`Background: ${line}`, "Taken Over by AI"));
        if (response && !response.ok && /failed to fetch/i.test(response.error || "")) {
          log("Background fetch failed; retrying through the local Foundry relay from the content script.", "Taken Over by AI");
          runClaudeAgentInContent(payload, logs)
            .then(resolve)
            .catch(e => resolve({ ok: false, error: e.message || response.error }));
          return;
        }
        resolve(response || { ok: false, error: "AI handoff returned no response." });
      });
    });
    if (!resp?.ok) {
      log(`AI handoff failed: ${resp?.error || "AI handoff failed"}`, `Hand over to Human - ${resp?.error || "AI handoff failed"}`, "error");
      setAiStatus(`Hand over to Human - ${resp?.error || "AI handoff failed"}`, "error");
      return { attempted: true, filled: 0, missing, error: resp?.error || "AI handoff failed", status: `Hand over to Human - ${resp?.error || "AI handoff failed"}`, logs };
    }

    let filled = 0;
    result._autoapplyAiResolvedLabels = result._autoapplyAiResolvedLabels || new Set();
    log("Reading Claude's proposed field actions and matching them back to visible required and Education Details controls.", "Taken Over by AI");
    for (const action of resp.actions || resp.answers || []) {
      if (action.type && action.type !== "fill") continue;
      const field = missing.find(item => item.id && item.id === action.id) ||
                    missing.find(item => item.label === action.label) ||
                    missing.find(item => item.label.toLowerCase() === String(action.label || "").toLowerCase());
      if (field) log(`Filling ${field.label} with value: ${summarizeAiValue(action.value)}.`, "Taken Over by AI");
      if (field && await fillAiAnswer(field, action.value)) {
        field.el.dataset.autoapplyAiFilled = "true";
        result._autoapplyAiResolvedLabels.add(field.label.toLowerCase().replace(/\s+/g, " ").trim());
        filled += 1;
        log(`Filled: ${field.label}`, "Taken Over by AI");
      } else {
        log(`Skipped AI action: ${action.label || action.id || "unknown field"}`, "Taken Over by AI");
      }
    }
    const status = resp.handoff || "Hand over to Human";
    log(`Status set to ${status}.`, status, "done");
    setAiStatus(status, "done");
    return { attempted: true, filled, missing: requiredMissingItems(result), status, logs };
  }

  function visiblePageReviewSnapshot(result) {
    const clean = value => String(value || "").replace(/\s+/g, " ").trim();
    const visible = el => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    };
    const valueFor = el => {
      const tag = (el.tagName || "").toLowerCase();
      const type = (el.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio") return el.checked ? "checked" : "unchecked";
      if (tag === "select") return clean(el.selectedOptions?.[0]?.textContent || el.value || "");
      const selectRoot = el.closest?.(".select__container, .select") || el.closest?.("[data-automation-id^='formField-']");
      const selected = selectRoot?.querySelector?.("[class*='single-value'], [data-automation-id='selectedItem']")?.textContent;
      if (selected) return clean(selected);
      if (el.getAttribute?.("aria-haspopup") === "listbox" || el.getAttribute?.("role") === "combobox") return clean(el.innerText || el.textContent || "");
      return clean(el.value || el.textContent || "");
    };
    const fields = Array.from(document.querySelectorAll("input, textarea, select, [role='combobox'], button[aria-haspopup='listbox']"))
      .filter(visible)
      .filter(el => {
        const type = (el.type || "").toLowerCase();
        return !["hidden", "submit", "button", "image", "reset", "file"].includes(type) || el.getAttribute?.("aria-haspopup") === "listbox";
      })
      .slice(0, 140)
      .map(el => ({
        id: el.id || "",
        name: el.name || "",
        label: fieldLabel(el).slice(0, 140),
        type: el.type || el.getAttribute?.("role") || el.tagName.toLowerCase(),
        required: isRequired(el),
        value: valueFor(el).slice(0, 240)
      }))
      .filter(field => field.label || field.id || field.name || field.value);
    const errors = Array.from(document.querySelectorAll('[aria-invalid="true"], [data-automation-id="errorMessage"], [data-automation-id="errorHeading"], [role="alert"]'))
      .filter(visible)
      .map(el => clean(el.innerText || el.getAttribute("aria-label") || el.id || ""))
      .filter(Boolean)
      .slice(0, 20);
    return {
      page: { url: location.href, title: document.title, formText: clean((document.querySelector("form") || document.body).innerText).slice(0, 6000) },
      fields,
      missing: requiredMissingItems(result).map(item => ({ id: item.id, name: item.name, label: item.label, type: item.type, reason: item.reason })),
      errors
    };
  }

  async function reviewPageBeforeHandoff(profile, result) {
    const existing = result.ai || { attempted: false, filled: 0, missing: requiredMissingItems(result), logs: [] };
    const logs = Array.isArray(existing.logs) ? [...existing.logs] : [];
    const addLog = (line, status = "AI reviewing page", tone = "working") => {
      logs.push(line);
      ns.Overlay.updateAi?.({ status, tone, appendLog: line });
    };
    addLog("AI review: scanning the visible page before handoff.");
    setAiStatus("AI reviewing page", "working");
    const snapshot = visiblePageReviewSnapshot(result);
    const fallbackComments = () => {
      if (snapshot.errors.length) return [`Needs review: ${snapshot.errors.slice(0, 3).join(" | ")}`];
      if (snapshot.missing.length) return [`Needs review: ${snapshot.missing.map(item => item.label).slice(0, 5).join(", ")} still appears unfilled.`];
      return ["Page review fallback: visible required fields did not show validation errors or obvious blanks. Data on the page looks good for human review; continue if the visible values match your profile."];
    };
    let review;
    try {
      review = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "claudeAgent.reviewPage", payload: { profile, ...snapshot } }, response => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(response || { ok: false, error: "AI page review returned no response." });
        });
      });
    } catch (e) {
      review = { ok: false, error: e.message || String(e) };
    }
    (review?.logs || []).forEach(line => addLog(`Review: ${line}`));
    const comments = review?.ok && review.comments?.length ? review.comments : fallbackComments();
    comments.forEach(comment => addLog(`AI review: ${comment}`, "AI review complete", review?.ok ? "done" : "error"));
    const status = review?.ok ? (review.handoff || "Hand over to Human") : `Hand over to Human - AI review fallback used${review?.error ? ` (${review.error})` : ""}`;
    addLog(`Status set to ${status}.`, status, review?.ok ? "done" : "error");
    setAiStatus(status, review?.ok ? "done" : "error");
    return { ...existing, attempted: true, missing: requiredMissingItems(result), status, review: { ok: !!review?.ok, comments, error: review?.error || null }, logs };
  }

  async function run() {
    const profile = await loadProfile();
    const url = new URL(window.location.href);
    const Handler = pickHandlerForPage(url);
    const site = new Handler(profile);
    ns.Overlay.clearMarks();
    const result = await site.fill();
    ns.Overlay.markFilled(result.filled.map((f) => f.el));
    ns.Overlay.markUnmapped(result.unmapped);
    ns.Overlay.highlightSubmit();
    const initialMissing = aiTargetItems(result);
    if (initialMissing.length) {
      result.ai = { attempted: true, filled: 0, missing: requiredMissingItems(result), status: "Taken Over by AI", logs: ["Preparing AI takeover for required and Education Details fields."] };
      ns.Overlay.showReview({
        ...result,
        site: Handler.label,
        onSubmit: trySubmit,
        onCancel: (reason) => { if (reason === "rescan") run(); }
      });
    }
    result.ai = await handOverMissingFieldsToAi(profile, result).catch(e => {
      setAiStatus(`Hand over to Human - ${e.message}`, "error");
      return { attempted: true, filled: 0, error: e.message, missing: requiredMissingItems(result) };
    });
    result.ai = await reviewPageBeforeHandoff(profile, result).catch(e => {
      const fallback = result.ai || { attempted: true, filled: 0, logs: [] };
      const logs = [...(fallback.logs || []), `AI review failed: ${e.message}`];
      setAiStatus(`Hand over to Human - AI review failed: ${e.message}`, "error");
      return { ...fallback, status: `Hand over to Human - AI review failed: ${e.message}`, logs, review: { ok: false, comments: [], error: e.message } };
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
      if (/\.myworkdayjobs\.com$|\.workday\.com$/.test(window.location.hostname)) {
        const auth = document.documentElement.getAttribute("data-autoapply-auth") || "";
        const hasErrors = !!document.querySelector('[aria-invalid="true"], [data-automation-id="errorMessage"], [data-automation-id="errorHeading"]') || /\bErrors Found\b/.test(document.body?.innerText || "");
        if (hasErrors || auth.includes("waiting:review-errors")) return null;
      }
      const profile = await loadProfile();
      const url = new URL(window.location.href);
      const Handler = pickHandlerForPage(url);
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
      if (!hasApplicationSurface()) return false;
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
      if (!hasApplicationSurface()) return false;
      ns.Overlay.clearMarks();
      document.querySelectorAll(".autoapply-toast").forEach((n) => n.remove());
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "autoapply.status") {
      if (!hasApplicationSurface()) return false;
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
    const QUESTION_SEL = "li.application-question, .application-question, fieldset.form-group, .tds-form-item, .tds-form-fieldset, .tds-form-input-group, [data-automation-id='applyFlowMyInfoPage'], [data-automation-id='applyFlowMyExpPage'], [data-automation-id^='applyFlow']";
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
        if (/\.myworkdayjobs\.com$|\.workday\.com$/.test(window.location.hostname)) {
          const auth = document.documentElement.getAttribute("data-autoapply-auth") || "";
          const hasErrors = !!document.querySelector('[aria-invalid="true"], [data-automation-id="errorMessage"], [data-automation-id="errorHeading"]') || /\bErrors Found\b/.test(document.body?.innerText || "");
          if (hasErrors || auth.includes("waiting:review-errors")) return;
        }
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
