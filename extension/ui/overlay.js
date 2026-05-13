// Overlay — renders the post-fill review toast and field highlights.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});

  const HIGHLIGHT_CLASS = "autoapply-highlight";
  const FILLED_CLASS = "autoapply-filled";

  function markFilled(els) {
    els.forEach((e) => e?.classList?.add(FILLED_CLASS));
  }
  function markUnmapped(els) {
    els.forEach((e) => e?.classList?.add(HIGHLIGHT_CLASS));
  }
  function clearMarks() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}, .${FILLED_CLASS}`)
      .forEach((e) => e.classList.remove(HIGHLIGHT_CLASS, FILLED_CLASS));
  }

  function describe(el) {
    const lbl = ns.FieldMatcher.collectLabelText(el);
    if (lbl) return lbl.slice(0, 80);
    return (el.name || el.id || el.tagName).toString().toLowerCase();
  }

  function showReview({ filled, unmapped, skipped, site, onSubmit, onCancel }) {
    document.querySelectorAll(".autoapply-toast").forEach((n) => n.remove());

    const toast = document.createElement("div");
    toast.className = "autoapply-toast";
    toast.innerHTML = `
      <button class="autoapply-close" title="Close">✕</button>
      <h4>AutoApply — ${site}</h4>
      <div class="autoapply-row"><span>Filled</span><b>${filled.length}</b></div>
      <div class="autoapply-row"><span>Needs review</span><b>${unmapped.length}</b></div>
      <div class="autoapply-row"><span>Skipped (file/empty)</span><b>${skipped.length}</b></div>
      ${unmapped.length ? `<ul class="autoapply-unmapped-list"></ul>` : ""}
      <div class="autoapply-actions">
        <button class="autoapply-primary">Looks good — submit</button>
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

  ns.Overlay = { markFilled, markUnmapped, clearMarks, showReview, HIGHLIGHT_CLASS, FILLED_CLASS };
})(typeof window !== "undefined" ? window : globalThis);
