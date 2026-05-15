// Background service worker. On first install, seed the default profile.

// ── Gmail helper ────────────────────────────────────────────────────────────

async function getGmailToken(interactive = true) {
  const CLIENT_ID = '969122121042-8vrekp0o4g4gr4edsm5dbieik0aottt6.apps.googleusercontent.com';
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scope = 'https://www.googleapis.com/auth/gmail.readonly';
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent(scope)}`;
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (responseUrl) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!responseUrl) return reject(new Error('Auth cancelled'));
      const fragment = responseUrl.includes('#')
        ? responseUrl.split('#')[1]
        : responseUrl.split('?')[1] || '';
      const params = new URLSearchParams(fragment);
      const token = params.get('access_token');
      if (!token) return reject(new Error('No access_token in response'));
      resolve(token);
    });
  });
}

function gmailGet(token, path) {
  return fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
}

// Decode a Gmail base64url payload part to a plain string.
function decodeGmailBody(data) {
  try {
    return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  } catch (_) { return ""; }
}

// Walk Gmail message payload parts depth-first; return the first text matching mime.
function extractPart(payload, mime) {
  if (!payload) return "";
  if (payload.mimeType === mime && payload.body?.data) return decodeGmailBody(payload.body.data);
  for (const part of payload.parts || []) {
    const found = extractPart(part, mime);
    if (found) return found;
  }
  return "";
}

// Extract the first https URL that looks like a Workday verify/activate link.
function extractWorkdayLink(text) {
  const re = /https?:\/\/[^\s"'<>)]+(?:verify|activate|confirm|token)[^\s"'<>)]+/gi;
  const matches = text.match(re);
  return matches ? matches[0].replace(/&amp;/g, "&") : null;
}

async function fetchRecentEmails(count = 5) {
  const token = await getGmailToken(true);
  const list = await gmailGet(token, `/messages?maxResults=${count}&labelIds=INBOX`);
  if (!list.messages) return [];

  const emails = await Promise.all(list.messages.map(async (m) => {
    const msg = await gmailGet(token, `/messages/${m.id}?format=full`);
    const hdrs = msg.payload?.headers || [];
    const hdr = (name) => hdrs.find(h => h.name.toLowerCase() === name)?.value || "";

    const htmlBody = extractPart(msg.payload, "text/html");
    const textBody = extractPart(msg.payload, "text/plain");
    const body = htmlBody || textBody;
    const verifyLink = extractWorkdayLink(body);

    return {
      id: m.id,
      from: hdr("from"),
      subject: hdr("subject"),
      date: hdr("date"),
      snippet: (msg.snippet || "").slice(0, 120),
      verifyLink      // null unless this email contains a Workday verify URL
    };
  }));

  return emails;
}

// ── Message handlers ─────────────────────────────────────────────────────────

const FOUNDRY_KEY = "autoapply.foundry";

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
    logs.push("Trying local Foundry relay at 127.0.0.1:8765.");
    const relayRes = await fetch("http://127.0.0.1:8765/foundry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls, apiKey: cfg.apiKey, body })
    });
    const relayJson = await relayRes.json().catch(() => ({}));
    if (relayRes.ok) return relayJson;
    lastError = relayJson.error || `Local Foundry relay failed: ${relayRes.status}`;
    logs.push(lastError);
  } catch (e) {
    logs.push(`Local Foundry relay unavailable: ${e.message || String(e)}.`);
  }

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

async function runClaudeSdkAgentTask(payload) {
  const logs = [];
  const stored = await new Promise((resolve, reject) => {
    chrome.storage.sync.get(FOUNDRY_KEY, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result || {});
    });
  });
  const cfg = normalizeFoundryConfig(stored?.[FOUNDRY_KEY] || {});
  const missing = missingFoundrySettings(cfg);
  if (missing.length) {
    throw new Error(`Foundry settings are missing in the extension popup: ${missing.join(", ")}.`);
  }

  const model = cfg.model;
  logs.push(`Using Claude SDK Agent contract with model ${model}.`);

  const agentTask = {
    agent: "AutoApply Claude SDK Agent",
    objective: "Scan the whole application page and fill every safe, answerable remaining field, then return control to the human.",
    instructions: [
      "Read the full page context and all fieldsToFill before deciding actions.",
      "Use only the provided profile JSON, resume/details text, and page context.",
      "When options are provided for a dropdown, choose one exact option from that list.",
      "For 'How did you hear about this job?' source fields, prefer recruiter, talent acquisition, sourcer, reached out, or contacted options; avoid LinkedIn, job board, or job site options when a recruiter-style option exists.",
      "Create field-fill actions for every field you can answer confidently from the supplied data, including optional profile, location, education, employment, work authorization, and screening fields.",
      "Education Details fields such as School, Degree, Discipline, field of study, major, and graduation date must be filled from profile.education when present.",
      "For yes/no fields, answer with Yes or No.",
      "Do not submit the application.",
      "Return strict JSON only."
    ],
    outputSchema: {
      actions: [
        { type: "fill", id: "field id", label: "field label", value: "answer" }
      ],
      handoff: "Hand over to Human"
    },
    fieldsToFill: payload.fields || [],
    profile: payload.profile || {},
    resumeText: payload.resumeText || "",
    page: payload.page || {}
  };

  const prompt = [
    "You are AutoApply Claude SDK Agent.",
    "Run this agent task and return only the JSON matching outputSchema.",
    "",
    JSON.stringify(agentTask, null, 2)
  ].join("\n");

  const body = {
    model,
    max_tokens: 1200,
    temperature: 0,
    messages: [{ role: "user", content: prompt }]
  };

  let json;
  try {
    json = await fetchClaudeMessages(foundryRequestUrls(cfg.resource, cfg.baseUrl), cfg, body, logs);
  } catch (e) {
    e.logs = logs;
    throw e;
  }

  const text = json.content?.map?.(part => part.text || "").join("\n") ||
               json.choices?.[0]?.message?.content ||
               json.output_text ||
               json.text || "";
  const parsed = parseClaudeAgentJson(text) || json;
  const actions = Array.isArray(parsed.actions) ? parsed.actions :
                  Array.isArray(parsed.answers) ? parsed.answers.map(a => ({ type: "fill", ...a })) : [];
  logs.push(`Claude agent returned ${actions.length} action${actions.length === 1 ? "" : "s"}.`);
  return { actions, handoff: parsed.handoff || "Hand over to Human", logs };
}

async function runClaudeSdkReviewTask(payload) {
  const logs = [];
  const stored = await new Promise((resolve, reject) => {
    chrome.storage.sync.get(FOUNDRY_KEY, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result || {});
    });
  });
  const cfg = normalizeFoundryConfig(stored?.[FOUNDRY_KEY] || {});
  const missing = missingFoundrySettings(cfg);
  if (missing.length) {
    throw new Error(`Foundry settings are missing in the extension popup: ${missing.join(", ")}.`);
  }

  const model = cfg.model;
  logs.push(`Using Claude page-review contract with model ${model}.`);
  const reviewTask = {
    agent: "AutoApply Final Page Reviewer",
    objective: "Review the visible application page after autofill and return concise comments before handing control to the human.",
    instructions: [
      "Review visible fields, values, validation errors, and required missing fields.",
      "Do not invent hidden page state. Base comments only on the supplied snapshot.",
      "If required fields or obvious wrong values remain, list them clearly.",
      "If the page looks ready for human review/Next, say the data on the page looks good and mention any remaining manual review items.",
      "Do not submit the application.",
      "Return strict JSON only."
    ],
    outputSchema: {
      status: "looks_good | needs_review",
      comments: ["short human-readable comment"],
      handoff: "Hand over to Human"
    },
    profile: payload.profile || {},
    page: payload.page || {},
    fields: payload.fields || [],
    missing: payload.missing || [],
    errors: payload.errors || []
  };

  const body = {
    model,
    max_tokens: 700,
    temperature: 0,
    messages: [{ role: "user", content: `You are AutoApply Final Page Reviewer. Return only JSON.\n\n${JSON.stringify(reviewTask, null, 2)}` }]
  };

  let json;
  try {
    json = await fetchClaudeMessages(foundryRequestUrls(cfg.resource, cfg.baseUrl), cfg, body, logs);
  } catch (e) {
    e.logs = logs;
    throw e;
  }
  const text = json.content?.map?.(part => part.text || "").join("\n") ||
               json.choices?.[0]?.message?.content ||
               json.output_text ||
               json.text || "";
  const parsed = parseClaudeAgentJson(text) || json;
  const comments = Array.isArray(parsed.comments) ? parsed.comments :
                   (parsed.comment ? [parsed.comment] : []);
  logs.push(`Claude page review returned ${comments.length} comment${comments.length === 1 ? "" : "s"}.`);
  return { status: parsed.status || "needs_review", comments, handoff: parsed.handoff || "Hand over to Human", logs };
}

// Fill an input in the page's MAIN world (bypasses isolated-world React
// tracker issues). Content scripts send this message when the normal
// isolated-world fill doesn't notify React's own-property tracker.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "claudeAgent.fillMissingFields") {
    let responded = false;
    const safeSend = (response) => {
      if (responded) return;
      responded = true;
      try { sendResponse(response); } catch (_) {}
    };
    const timeout = setTimeout(() => {
      safeSend({ ok: false, error: "AI handoff timed out." });
    }, 45000);
    runClaudeSdkAgentTask(msg.payload || {})
      .then(result => { clearTimeout(timeout); safeSend({ ok: true, ...result }); })
      .catch(e => { clearTimeout(timeout); safeSend({ ok: false, error: e.message || String(e), logs: e.logs || [] }); });
    return true;
  }

  if (msg.type === "claudeAgent.reviewPage") {
    let responded = false;
    const safeSend = (response) => {
      if (responded) return;
      responded = true;
      try { sendResponse(response); } catch (_) {}
    };
    const timeout = setTimeout(() => {
      safeSend({ ok: false, error: "AI page review timed out." });
    }, 45000);
    runClaudeSdkReviewTask(msg.payload || {})
      .then(result => { clearTimeout(timeout); safeSend({ ok: true, ...result }); })
      .catch(e => { clearTimeout(timeout); safeSend({ ok: false, error: e.message || String(e), logs: e.logs || [] }); });
    return true;
  }

  if (msg.type === "gmail.fetchRecent") {
    fetchRecentEmails(msg.count || 5)
      .then(emails => sendResponse({ ok: true, emails }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "gmail.signOut") {
    // launchWebAuthFlow tokens are not cached by the identity API;
    // sign-out is just clearing any browser-cached state.
    chrome.identity.clearAllCachedAuthTokens(() => sendResponse({ ok: true }));
    return true;
  }

  // Fill a Greenhouse react-select combobox by calling selectOption directly
  // on the React fiber instance (main world only — isolated world cannot call
  // main-world React methods or dispatch trusted events).
  if (msg.type === "ghSelectOption" && sender.tab?.id) {
    const target = { tabId: sender.tab.id };
    if (Number.isInteger(sender.frameId) && sender.frameId >= 0) target.frameIds = [sender.frameId];
    chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: async (inputId, targets, displayValue) => {
        function getSelectInstance(el) {
          const container = el?.closest('.select__container') || el?.closest('.select');
          if (!container) return null;
          const fiberKey = Object.keys(container).find(k => k.startsWith('__reactFiber'));
          if (!fiberKey) return null;
          const queue = [container[fiberKey]];
          const visited = new Set();
          while (queue.length) {
            const node = queue.shift();
            if (!node || visited.has(node)) continue;
            visited.add(node);
            if (node.stateNode && (typeof node.stateNode?.selectOption === 'function' || typeof node.stateNode?.props?.onChange === 'function')) return node.stateNode;
            if (node.child) queue.push(node.child);
            if (node.sibling) queue.push(node.sibling);
          }
          return null;
        }
        const el = document.getElementById(inputId);
        if (!el) return false;
        const inst = getSelectInstance(el);
        if (!inst) return false;
        async function loadOptions(query) {
          if (typeof inst.props?.loadOptions !== 'function' || !query) return [];
          try {
            const loaded = await inst.props.loadOptions(query, () => {});
            if (Array.isArray(loaded)) return loaded;
            if (Array.isArray(loaded?.options)) return loaded.options;
          } catch (_) {}
          return [];
        }
        function normalizeText(value) {
          return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[’']/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/gi, ' ')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ');
        }
        const normalizedTargets = Array.from(new Set([...(targets || []), displayValue].map(normalizeText).filter(Boolean)));
        function matchesOption(option, target) {
          const label = normalizeText(option?.label || '');
          const value = normalizeText(option?.value ?? '');
          const normalizedTarget = normalizeText(target);
          return label === normalizedTarget || value === normalizedTarget || (normalizedTarget.length >= 3 && label && (label.includes(normalizedTarget) || normalizedTarget.includes(label)));
        }
        function chooseOption(options) {
          for (const target of normalizedTargets) {
            const opt = options.find(option => matchesOption(option, target));
            if (opt) return opt;
          }
          return null;
        }
        function searchQueries() {
          const queries = [];
          const add = value => {
            const raw = String(value || '').trim();
            const normalized = normalizeText(raw);
            for (const query of [raw, normalized]) {
              if (query && !queries.includes(query)) queries.push(query);
            }
          };
          [...(targets || []), displayValue].forEach(add);
          for (const target of normalizedTargets) {
            const words = target.split(' ').filter(Boolean);
            words.forEach(add);
            for (let index = 1; index <= Math.min(target.length, 12); index += 1) add(target.slice(0, index));
            words.forEach(word => {
              for (let index = 1; index <= Math.min(word.length, 8); index += 1) add(word.slice(0, index));
            });
          }
          return queries;
        }
        function applyOption(opt) {
          if (!opt) return false;
          let applied = false;
          try { inst.props?.onMenuOpen?.(); } catch (_) {}
          try { inst.props?.onInputChange?.(opt.label || displayValue || '', { action: 'input-change' }); } catch (_) {}
          if (typeof inst.selectOption === 'function') {
            try { inst.selectOption(opt); applied = true; } catch (_) {}
          }
          if (typeof inst.props?.onChange === 'function') {
            try { inst.props.onChange(opt, { action: 'select-option', option: opt, name: inst.props?.name }); applied = true; } catch (_) {}
          }
          if (typeof inst.setValue === 'function') {
            try { inst.setValue(opt, 'select-option', opt); applied = true; } catch (_) {}
          }
          if (!applied) return false;
          try { inst.props?.onInputChange?.('', { action: 'set-value' }); } catch (_) {}
          try { inst.props?.onMenuClose?.(); } catch (_) {}
          try { inst.forceUpdate?.(); } catch (_) {}
          return true;
        }

        const initialOptions = inst.props?.options || [];
        const initialChoice = chooseOption(initialOptions);
        if (applyOption(initialChoice)) return true;

        for (const query of searchQueries()) {
          const options = await loadOptions(query);
          const opt = chooseOption(options);
          if (applyOption(opt)) return true;
        }

        if (typeof inst.props?.onChange === 'function' && displayValue) {
          const option = { label: displayValue, value: displayValue };
          return applyOption(option);
        }
        return false;
      },
      args: [msg.inputId, msg.targets, msg.value || '']
    })
      .then(results => sendResponse({ ok: results?.[0]?.result === true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

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
