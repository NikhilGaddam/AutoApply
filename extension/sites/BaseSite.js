// BaseSite : common workflow for site-specific handlers.
// Subclasses override: hostMatches(url), findFields(), customMappings(), and optionally fill().
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});
  const { FieldMatcher, FormFiller } = ns;

  class BaseSite {
    /** Site identifier (used for logging/UI). */
    static id = "base";
    /** Human-readable name. */
    static label = "Generic";

    /**
     * Static check whether this handler is appropriate for the current page.
     * @param {URL} url
     * @returns {boolean}
     */
    static hostMatches(url) { return false; }

    constructor(profile) {
      this.profile = profile;
    }

    /**
     * Returns all candidate fillable form elements on the page.
     * Subclasses can narrow this to the application form scope.
     */
    findFields() {
      const selectors = "input, select, textarea, [contenteditable='true']";
      return Array.from(document.querySelectorAll(selectors)).filter(FormFiller.isFillable);
    }

    /**
     * Optional site-specific direct mappings.
     * Return a Map<HTMLElement, string> of element -> profile dotted key.
     * Used as a precedence layer over generic field matching.
     */
    customMappings() { return new Map(); }

    /**
     * Resolve a profile value for a given element.
     * Returns { key, value } or null.
     */
    resolveField(el, overrides) {
      const key = overrides.get(el) || FieldMatcher.matchField(el);
      if (!key) return null;
      const value = FieldMatcher.getProfileValue(this.profile, key);
      if (value == null || value === "") return { key, value: null };
      return { key, value };
    }

    /**
     * Main fill routine.
     * @returns {{filled: Array, unmapped: Array, skipped: Array}}
     */
    async fill() {
      const filled = [];
      const unmapped = [];
      const skipped = [];
      const overrides = this.customMappings();
      const fields = this.findFields();
      const { ResumeUploader } = ns;

      for (const el of fields) {
        // File inputs: try resume/CV auto-upload
        if (el.tagName.toLowerCase() === "input" && (el.type || "").toLowerCase() === "file") {
          const kind = ResumeUploader?.classifyFileInput(el);
          if (kind === "resume" && this.profile?.resumeAsset) {
            try {
              const ok = await ResumeUploader.uploadResume(el, this.profile);
              if (ok) { filled.push({ el, key: "resume", value: this.profile.resumeFileName }); continue; }
            } catch (e) { console.warn("AutoApply: resume upload failed", e); }
          }
          skipped.push({ el, reason: "file-upload" });
          continue;
        }
        const resolved = this.resolveField(el, overrides);
        if (!resolved) { unmapped.push(el); continue; }
        if (resolved.value == null) { skipped.push({ el, reason: `no-value:${resolved.key}` }); continue; }
        const ok = FormFiller.fillField(el, resolved.value);
        if (ok) filled.push({ el, key: resolved.key, value: resolved.value });
        else unmapped.push(el);
      }

      // Auto-accept consent / terms / acknowledgment checkboxes. Any standalone
      // unmapped checkbox whose surrounding label text matches consent patterns
      // is checked by default. Radio groups, multi-option checkboxes, and any
      // checkbox already mapped to a profile key are NOT touched here.
      const stillUnmapped = [];
      for (const el of unmapped) {
        if (el.tagName === "INPUT" && (el.type || "").toLowerCase() === "checkbox") {
          if (this.tryAcceptConsent(el)) {
            filled.push({ el, key: "consent", value: true });
            continue;
          }
        }
        stillUnmapped.push(el);
      }
      return { filled, unmapped: stillUnmapped, skipped, site: this.constructor.id };
    }

    /**
     * If a standalone checkbox looks like a consent / terms / acknowledgment
     * field, tick it. Uses both the field-matcher label text and a fallback
     * scan of nearby ancestor text (some consent boxes have no <label> at all
     * \u2014 just adjacent paragraphs).
     */
    tryAcceptConsent(el) {
      if (!el || el.checked) return false;
      // Belongs to a multi-checkbox group? Skip \u2014 user picks options themselves.
      if (el.name) {
        const peers = document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`);
        if (peers.length > 1) return false;
      }
      const { FieldMatcher } = ns;
      let text = (FieldMatcher.collectLabelText(el) || "");
      if (!text) {
        // Walk up a few ancestors and grab their text (cap length).
        let node = el.parentElement, hops = 0;
        while (node && hops < 4 && text.length < 40) {
          text = (node.innerText || "").toLowerCase();
          node = node.parentElement;
          hops += 1;
        }
      }
      const CONSENT_RE = /\b(i\s+(agree|accept|consent|acknowledge|certify|confirm)|terms\s+(and|&)\s+conditions|privacy\s+(policy|notice)|terms\s+of\s+(use|service)|accept\s+(the\s+)?(terms|policy|conditions)|i\s+have\s+read|conditions\s+of\s+(employment|application)|legal\s+acknowledgment)\b/i;
      if (!CONSENT_RE.test(text)) return false;
      el.click();
      // If click didn't take (framework guards), set checked + fire change.
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return el.checked;
    }
  }

  ns.BaseSite = BaseSite;
})(typeof window !== "undefined" ? window : globalThis);