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
    const lbl = ns.FieldMatcher.collectLabelText(el);
    if (lbl) return lbl.slice(0, 80);
    return (el.name || el.id || el.tagName).toString().toLowerCase();
  }

  function showReview({ filled, unmapped, skipped, site, onSubmit, onCancel }) {
    document.querySelectorAll(".autoapply-toast").forEach((n) => n.remove());

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
      ${unmapped.length ? `<ul class="autoapply-unmapped-list"></ul>` : ""}
      <div class="autoapply-actions">
        <button class="autoapply-primary">${primaryLabel}</button>
        <button class="autoapply-secondary">Re-scan</button>
        <button class="autoapply-danger">Clear</button>
      </div>
    `;

    const list = toast.querySelector(".autoapply-unmapped-list");
    if (list) {
      unmapped.forEach((el) => {
        const li = document.createElement("li");
        li.textContent = "• " + describe(el);
        li.addEventListener("click", () => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.focus?.();
        });
        list.appendChild(li);
      });
    }

    toast.querySelector(".autoapply-close").addEventListener("click", () => toast.remove());
    toast.querySelector(".autoapply-primary").addEventListener("click", () => {
      toast.remove();
      onSubmit?.();
    });
    toast.querySelector(".autoapply-secondary").addEventListener("click", () => {
      toast.remove();
      onCancel?.("rescan");
    });
    toast.querySelector(".autoapply-danger").addEventListener("click", () => {
      clearMarks();
      toast.remove();
    });

    document.body.appendChild(toast);
  }

  ns.Overlay = { markFilled, markUnmapped, clearMarks, showReview, findSubmitButton, findNextButton, getSubmitKind, highlightSubmit, focusSubmit, HIGHLIGHT_CLASS, FILLED_CLASS, SUBMIT_CLASS };
})(typeof window !== "undefined" ? window : globalThis);
