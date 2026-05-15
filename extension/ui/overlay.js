// Overlay : renders the post-fill review toast and field highlights.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});

  const HIGHLIGHT_CLASS = "autoapply-highlight";
  const FILLED_CLASS = "autoapply-filled";
  const SUBMIT_CLASS = "autoapply-submit-ready";

  function markFilled(els) {
    els.forEach((e) => e?.classList?.add(FILLED_CLASS));
  }
  function markUnmapped(els) {
    els.forEach((e) => e?.classList?.add(HIGHLIGHT_CLASS));
  }
  function clearMarks() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}, .${FILLED_CLASS}, .${SUBMIT_CLASS}`)
      .forEach((e) => e.classList.remove(HIGHLIGHT_CLASS, FILLED_CLASS, SUBMIT_CLASS));
  }

  // Find the page's primary action button. For multi-step forms (Tesla,
  // Workday) this is a "Next" / "Continue" / "Save and Continue" button : we
  // never want to surface "Submit" if the form is paginated and a Next exists.
  // Returns { el, kind } where kind is 'next' or 'submit'.
  function findNextButton() {
    const btns = Array.from(document.querySelectorAll("form button, form input[type='button'], form input[type='submit']"));
    return btns.find((b) => {
      if (b.disabled || b.type === "reset") return false;
      const t = (b.innerText || b.value || "").trim();
      return /^(next|continue|save( and)? continue|proceed|next step)$/i.test(t);
    }) || null;
  }

  function findSubmitButton() {
    // Prefer a visible Next/Continue on multi-step forms.
    const next = findNextButton();
    if (next) return next;
    const inForm = document.querySelector(
      "form#application-form button[type='submit'], form button[type='submit'], input[type='submit']"
    );
    if (inForm) return inForm;
    const btns = Array.from(document.querySelectorAll("button, input[type='button']"));
    return btns.find((b) => {
      const t = (b.innerText || b.value || "").trim();
      return /^(submit( application)?|apply|send( application)?)$/i.test(t);
    }) || null;
  }

  function getSubmitKind() {
    return findNextButton() ? "next" : "submit";
  }

  function highlightSubmit() {
    const btn = findSubmitButton();
    if (!btn) return null;
    btn.classList.add(SUBMIT_CLASS);
    return btn;
  }

  function focusSubmit() {
    const btn = findSubmitButton();
    if (!btn) return null;
    btn.classList.add(SUBMIT_CLASS);
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => btn.focus?.(), 350);
    return btn;
  }

  function describe(el) {
    const lbl = fieldLabel(el) || ns.FieldMatcher.collectLabelText(el);
    if (lbl) return lbl.slice(0, 80);
    return (el.name || el.id || el.tagName).toString().toLowerCase();
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

  function isRequiredField(el) {
    if (!el || el.name === "g-recaptcha-response" || /^g-recaptcha-response/.test(el.id || "")) return false;
    return el.required || el.getAttribute?.("aria-required") === "true" || /\*/.test(requiredText(el));
  }

  function showReview({ filled, unmapped, skipped, site, ai, onSubmit, onCancel }) {
    document.querySelectorAll(".autoapply-toast").forEach((n) => n.remove());

    const missing = [];
    const seen = new Set();
    const addMissing = (el) => {
      if (!isRequiredField(el) || hasValue(el)) return;
      const name = describe(el);
      if (!name) return;
      if (!seen.has(name)) { seen.add(name); missing.push({ el, name }); }
    };
    unmapped.forEach(el => addMissing(el));
    skipped.forEach(item => addMissing(item.el));

    const kind = getSubmitKind();
    const primaryLabel = kind === "next"
      ? "Looks good, go to next step"
      : "Looks good, submit";

    const toast = document.createElement("div");
    toast.className = "autoapply-toast";
    toast.innerHTML = `
      <button class="autoapply-close" title="Close">✕</button>
      <h4>AutoApply : ${site}</h4>
      <div class="autoapply-row"><span>Filled</span><b>${filled.length}</b></div>
      <div class="autoapply-row"><span>Needs review</span><b>${unmapped.length}</b></div>
      <div class="autoapply-row"><span>Skipped (file/empty)</span><b>${skipped.length}</b></div>
      ${ai?.attempted ? `<div class="autoapply-ai-panel">
        <div class="autoapply-ai-header">
          <span>AI status</span>
          <b data-tone="${ai.error ? "error" : "done"}"></b>
        </div>
        <details class="autoapply-ai-logs" ${ai.error ? "open" : ""}>
          <summary>AI logs</summary>
          <ol></ol>
        </details>
      </div>` : ""}
      ${missing.length ? `<div class="autoapply-missing-title">Missing fields</div><ul class="autoapply-unmapped-list"></ul>` : ""}
      <div class="autoapply-actions">
        <button class="autoapply-primary">${primaryLabel}</button>
        <button class="autoapply-secondary">Re-scan</button>
        <button class="autoapply-danger">Clear</button>
      </div>
    `;

    const aiStatus = toast.querySelector(".autoapply-ai-header b");
    if (aiStatus) aiStatus.textContent = ai.status || (ai.error ? `Hand over to Human - ${ai.error}` : "Hand over to Human");

    const list = toast.querySelector(".autoapply-unmapped-list");
    if (list) {
      missing.forEach(({ el, name }) => {
        const li = document.createElement("li");
        li.textContent = name;
        li.addEventListener("click", () => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.focus?.();
        });
        list.appendChild(li);
      });
    }

    const aiLogList = toast.querySelector(".autoapply-ai-logs ol");
    if (aiLogList) {
      (ai.logs || []).forEach((line) => {
        const li = document.createElement("li");
        li.textContent = String(line);
        aiLogList.appendChild(li);
      });
      if (!ai.logs?.length) {
        const li = document.createElement("li");
        li.textContent = "No AI log entries were recorded.";
        aiLogList.appendChild(li);
      }
    }

    // ── Workday live status + Pause/Resume ────────────────────────────────
    const isWorkday = /\.myworkdayjobs\.com$|\.workday\.com$/.test(window.location.hostname);
    let statusInterval = null;
    if (isWorkday) {
      const statusBar = document.createElement("div");
      statusBar.className = "autoapply-wd-bar";

      function refreshStatus() {
        const auth = document.documentElement.getAttribute("data-autoapply-auth") || "";
        const paused = !!window.__autoApplyWorkdayPaused;
        let icon, label, cls, hint = "";
        if (paused && auth.includes("email-verify")) {
          icon = "⏸"; label = "Waiting: verify email"; cls = "warn";
          hint = "Check your inbox and click the Workday link, then Resume.";
        } else if (paused) {
          icon = "⏸"; label = "Paused"; cls = "warn";
        } else if (auth.includes("submit:signin")) {
          icon = "⟳"; label = "Signing in…"; cls = "info";
        } else if (auth.includes("submit:create")) {
          icon = "⟳"; label = "Creating account…"; cls = "info";
        } else if (auth.includes("email-verify")) {
          icon = "⏸"; label = "Waiting: verify email"; cls = "warn";
          hint = "Check your inbox and click the Workday link, then Resume.";
        } else if (auth.includes("result:success")) {
          icon = "✓"; label = "Signed in"; cls = "ok";
        } else {
          icon = "⟳"; label = "Running…"; cls = "info";
        }
        statusBar.innerHTML = `
          <div class="wd-status-row">
            <span class="wd-badge wd-badge-${cls}">${icon} ${label}</span>
            <button class="wd-pause-btn">${paused ? "▶ Resume" : "⏸ Pause"}</button>
          </div>
          ${hint ? `<div class="wd-hint">${hint}</div>` : ""}
        `;
        statusBar.querySelector(".wd-pause-btn").addEventListener("click", () => {
          window.__autoApplyWorkdayPaused = !window.__autoApplyWorkdayPaused;
          refreshStatus();
        });
      }

      refreshStatus();
      statusInterval = setInterval(refreshStatus, 2000);
      toast.querySelector(".autoapply-actions").before(statusBar);
    }

    function cleanup() { if (statusInterval) clearInterval(statusInterval); }

    toast.querySelector(".autoapply-close").addEventListener("click", () => { cleanup(); toast.remove(); });
    toast.querySelector(".autoapply-primary").addEventListener("click", () => {
      cleanup(); toast.remove();
      onSubmit?.();
    });
    toast.querySelector(".autoapply-secondary").addEventListener("click", () => {
      cleanup(); toast.remove();
      onCancel?.("rescan");
    });
    toast.querySelector(".autoapply-danger").addEventListener("click", () => {
      cleanup(); clearMarks();
      toast.remove();
    });

    document.body.appendChild(toast);
  }

  ns.Overlay = { markFilled, markUnmapped, clearMarks, showReview, findSubmitButton, findNextButton, getSubmitKind, highlightSubmit, focusSubmit, HIGHLIGHT_CLASS, FILLED_CLASS, SUBMIT_CLASS };
})(typeof window !== "undefined" ? window : globalThis);
