// BaseSite — common workflow for site-specific handlers.
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
    fill() {
      const filled = [];
      const unmapped = [];
      const skipped = [];
      const overrides = this.customMappings();
      const fields = this.findFields();

      for (const el of fields) {
        // Skip file inputs — they need user action
        if (el.tagName.toLowerCase() === "input" && (el.type || "").toLowerCase() === "file") {
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
      return { filled, unmapped, skipped, site: this.constructor.id };
    }
  }

  ns.BaseSite = BaseSite;
})(typeof window !== "undefined" ? window : globalThis);
