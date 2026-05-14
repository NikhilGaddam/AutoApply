async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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

  try { siteEl.textContent = new URL(tab.url).hostname; } catch (_) {}

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
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "autoapply.fill" });
      if (res?.ok) {
        msgEl.textContent = `Filled ${res.filled} · ${res.unmapped} need review (${res.site})`;
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
})();
