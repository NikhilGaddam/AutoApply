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

function parseAiJson(text) {
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

async function fillMissingFieldsWithAi(payload) {
  const stored = await chrome.storage.sync.get(FOUNDRY_KEY);
  const cfg = stored?.[FOUNDRY_KEY] || {};
  if (!cfg.apiKey || !cfg.resource || !cfg.baseUrl) {
    throw new Error("Foundry settings are missing in the extension popup.");
  }

  const baseUrl = String(cfg.baseUrl).replace(/\/+$/, "");
  const resource = String(cfg.resource).replace(/^\/+/, "");
  const url = /^https?:\/\//i.test(cfg.resource) ? cfg.resource : `${baseUrl}/${resource}`;
  const model = cfg.model || "sonnet";

  const prompt = [
    "You are filling required missing fields on a job application for Nikhil Gaddam.",
    "Use only the provided profile JSON, resume/details text, and page context.",
    "Return strict JSON only in this shape:",
    "{\"answers\":[{\"id\":\"field id\",\"label\":\"field label\",\"value\":\"answer\"}]}",
    "For yes/no fields, answer with Yes or No. If the profile does not contain enough information, omit that field.",
    "",
    "Missing required fields:",
    JSON.stringify(payload.fields || [], null, 2),
    "",
    "Profile JSON and details:",
    JSON.stringify(payload.profile || {}, null, 2),
    "",
    "Resume/details text:",
    payload.resumeText || "",
    "",
    "Page context:",
    JSON.stringify(payload.page || {}, null, 2)
  ].join("\n");

  const body = {
    model,
    max_tokens: 1200,
    temperature: 0,
    messages: [{ role: "user", content: prompt }]
  };

  const res = await fetch(url, {
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
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || json.message || `Foundry request failed: ${res.status}`);

  const text = json.content?.map?.(part => part.text || "").join("\n") ||
               json.choices?.[0]?.message?.content ||
               json.output_text ||
               json.text || "";
  const parsed = parseAiJson(text) || json;
  const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
  return { answers };
}

// Fill an input in the page's MAIN world (bypasses isolated-world React
// tracker issues). Content scripts send this message when the normal
// isolated-world fill doesn't notify React's own-property tracker.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ai.fillMissingFields") {
    fillMissingFieldsWithAi(msg.payload || {})
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
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
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: (inputId, targets) => {
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
            if (node.stateNode && typeof node.stateNode?.selectOption === 'function') return node.stateNode;
            if (node.child) queue.push(node.child);
            if (node.sibling) queue.push(node.sibling);
          }
          return null;
        }
        const el = document.getElementById(inputId);
        if (!el) return false;
        const inst = getSelectInstance(el);
        if (!inst) return false;
        const options = inst.props?.options || [];
        for (const target of targets) {
          let opt = options.find(o => (o.label || '').toLowerCase().trim() === target);
          if (!opt && target.length >= 3) {
            opt = options.find(o => {
              const l = (o.label || '').toLowerCase().trim();
              return l && (l.includes(target) || target.includes(l));
            });
          }
          if (opt) { inst.selectOption(opt); return true; }
        }
        return false;
      },
      args: [msg.inputId, msg.targets]
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
