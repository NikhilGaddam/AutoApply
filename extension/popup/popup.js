async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const FOUNDRY_KEY = "autoapply.foundry";
const DEFAULT_FOUNDRY = {
  apiKey: "",
  resource: "",
  model: "sonnet"
};

function normalizeFoundryConfig(raw = {}) {
  return {
    apiKey: raw.apiKey || raw.api_key || raw.key || raw.ANTHROPIC_FOUNDRY_API_KEY || "",
    resource: raw.resource || raw.endpoint || raw.url || raw.ANTHROPIC_FOUNDRY_RESOURCE || "",
    model: raw.model || raw.claudeModel || raw.ANTHROPIC_MODEL || DEFAULT_FOUNDRY.model
  };
}

function humanStatus(s) {
  if (!s) return { text: "Starting…", dot: "gray" };
  const auth = s.authState || "";
  if (s.paused) {
    if (auth.includes("email-verify"))
      return { text: "Waiting: verify email", dot: "yellow", showVerify: true };
    return { text: "Paused", dot: "yellow" };
  }
  if (auth.includes("submit:signin"))  return { text: "Signing in…",            dot: "blue" };
  if (auth.includes("submit:create"))  return { text: "Creating account…",       dot: "blue" };
  if (auth.includes("result:success")) return { text: "Signed in ✓",             dot: "green" };
  if (auth.includes("result:error") || auth.includes("result:timeout"))
                                       return { text: "Sign-in failed → creating account…", dot: "yellow" };
  if (auth.includes("email-verify"))   return { text: "Waiting: verify email",   dot: "yellow", showVerify: true };
  if (s.step === "form")               return { text: "Filling application…",    dot: "green" };
  if (s.step === "auth")               return { text: "Authenticating…",         dot: "blue" };
  if (s.step === "tiles")              return { text: "Detected job page…",      dot: "blue" };
  if (s.tickAge !== null && s.tickAge < 5000) return { text: "Running…",         dot: "green" };
  return { text: "Idle", dot: "gray" };
}

(async () => {
  const tab = await getActiveTab();
  const siteEl   = document.getElementById("site");
  const wdPanel  = document.getElementById("wd-panel");
  const dotEl    = document.getElementById("status-dot");
  const labelEl  = document.getElementById("status-label");
  const noticeEl = document.getElementById("verify-notice");
  const pauseBtn = document.getElementById("pause");
  const msgEl    = document.getElementById("msg");
  const missingListEl = document.getElementById("missing-list");

  const foundryApiKey = document.getElementById("foundry-api-key");
  const foundryResource = document.getElementById("foundry-resource");
  const foundryModel = document.getElementById("foundry-model");
  const foundrySave = document.getElementById("foundry-save");
  const foundryStatus = document.getElementById("foundry-status");

  try { siteEl.textContent = new URL(tab.url).hostname; } catch (_) {}

  async function loadFoundrySettings() {
    try {
      const stored = await chrome.storage.sync.get(FOUNDRY_KEY);
      const cfg = { ...DEFAULT_FOUNDRY, ...normalizeFoundryConfig(stored?.[FOUNDRY_KEY] || {}) };
      foundryApiKey.value = cfg.apiKey || "";
      foundryResource.value = cfg.resource || "";
      foundryModel.value = cfg.model || DEFAULT_FOUNDRY.model;
    } catch (_) {}
  }

  async function saveFoundrySettings() {
    const cfg = {
      apiKey: foundryApiKey.value.trim(),
      resource: foundryResource.value.trim(),
      model: foundryModel.value
    };
    foundrySave.disabled = true;
    foundryStatus.textContent = "Saving...";
    try {
      await chrome.storage.sync.set({ [FOUNDRY_KEY]: cfg });
      foundryStatus.textContent = "Saved.";
    } catch (e) {
      foundryStatus.textContent = "Could not save.";
    } finally {
      foundrySave.disabled = false;
    }
  }

  loadFoundrySettings();
  foundrySave.addEventListener("click", saveFoundrySettings);

  let isPaused = false;

  function applyStatus(s) {
    if (!s || !s.isWorkday) { wdPanel.classList.add("hidden"); return; }
    wdPanel.classList.remove("hidden");
    const { text, dot, showVerify } = humanStatus(s);
    dotEl.className = `dot dot-${dot}`;
    labelEl.textContent = text;
    noticeEl.classList.toggle("hidden", !showVerify);
    isPaused = s.paused || false;
    pauseBtn.textContent = isPaused ? "Resume" : "Pause";
    pauseBtn.style.background = isPaused ? "#dcfce7" : "";
    pauseBtn.style.color      = isPaused ? "#166534" : "";
  }

  // Poll status every 1.5 s while popup is open.
  async function pollStatus() {
    try {
      const s = await chrome.tabs.sendMessage(tab.id, { type: "autoapply.status" });
      applyStatus(s);
    } catch (_) { applyStatus(null); }
  }
  pollStatus();
  const pollInterval = setInterval(pollStatus, 1500);
  window.addEventListener("unload", () => clearInterval(pollInterval));

  // Pause / Resume button.
  pauseBtn.addEventListener("click", async () => {
    const type = isPaused ? "autoapply.resume" : "autoapply.pause";
    try { await chrome.tabs.sendMessage(tab.id, { type }); } catch (_) {}
    await pollStatus();
  });

  document.getElementById("fill").addEventListener("click", async () => {
    msgEl.textContent = "Filling…";
    missingListEl.innerHTML = "";
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "autoapply.fill" });
      if (res?.ok) {
        const missingFields = res.missingFields || [];
        msgEl.textContent = `Filled ${res.filled} · ${missingFields.length} required missing (${res.site})`;
        if (missingFields.length) {
          for (const name of missingFields) {
            const li = document.createElement("li");
            li.textContent = name;
            missingListEl.appendChild(li);
          }
        }
      } else {
        msgEl.textContent = res?.error || "Failed to fill.";
      }
    } catch (e) {
      msgEl.textContent = "Open an application page first.";
    }
  });

  document.getElementById("clear").addEventListener("click", async () => {
    try { await chrome.tabs.sendMessage(tab.id, { type: "autoapply.clear" }); } catch (_) {}
  });

  document.getElementById("options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // ── Gmail section ─────────────────────────────────────────────────────────
  const gmailFetchBtn = document.getElementById("gmail-fetch");
  const gmailStatus   = document.getElementById("gmail-status");
  const gmailList     = document.getElementById("gmail-list");

  function renderEmails(emails) {
    gmailList.innerHTML = "";
    if (!emails.length) { gmailStatus.textContent = "No messages found."; return; }
    gmailStatus.textContent = `Last ${emails.length} messages:`;

    for (const e of emails) {
      const li = document.createElement("li");
      if (e.verifyLink) li.className = "verify-email";

      const fromEl = document.createElement("div");
      fromEl.className = "email-from";
      fromEl.textContent = e.from;

      const subEl = document.createElement("div");
      subEl.className = "email-subject";
      subEl.textContent = e.subject || "(no subject)";

      const snipEl = document.createElement("div");
      snipEl.className = "email-snippet";
      snipEl.textContent = e.snippet;

      li.append(fromEl, subEl, snipEl);

      if (e.verifyLink) {
        const btn = document.createElement("button");
        btn.className = "verify-link-btn";
        btn.textContent = "✓ Open verification link";
        btn.addEventListener("click", () => {
          chrome.tabs.update(tab.id, { url: e.verifyLink });
          window.close();
        });
        li.appendChild(btn);
      }

      gmailList.appendChild(li);
    }
  }

  gmailFetchBtn.addEventListener("click", async () => {
    gmailFetchBtn.disabled = true;
    gmailFetchBtn.textContent = "Loading…";
    gmailStatus.textContent = "Connecting to Gmail…";
    gmailList.innerHTML = "";
    try {
      const res = await chrome.runtime.sendMessage({ type: "gmail.fetchRecent", count: 5 });
      if (res?.ok) {
        renderEmails(res.emails);
        gmailFetchBtn.textContent = "Refresh";
      } else {
        gmailStatus.textContent = res?.error || "Failed to fetch emails.";
        gmailFetchBtn.textContent = "Check inbox";
      }
    } catch (e) {
      gmailStatus.textContent = String(e);
      gmailFetchBtn.textContent = "Check inbox";
    } finally {
      gmailFetchBtn.disabled = false;
    }
  });
})();
