// Greenhouse (boards.greenhouse.io) : handles both standard inputs and
// react-select comboboxes (class="select__input") used for EEO and custom questions.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});
  const { BaseSite } = ns;

  class GreenhouseSite extends BaseSite {
    static id = "greenhouse";
    static label = "Greenhouse";

    static hostMatches(url) {
      return /(^|\.)(boards\.)?greenhouse\.io$/i.test(url.hostname) ||
             /greenhouse\.io/i.test(url.hostname);
    }

    customMappings() {
      const map = new Map();
      const byId = (id, key) => {
        const el = document.getElementById(id);
        if (el) map.set(el, key);
      };
      byId("first_name", "firstName");
      byId("last_name", "lastName");
      byId("email", "email");
      // Use local-number-only to avoid double-prefix with the country code selector
      byId("phone", "phoneLocal");
      return map;
    }

    /**
     * Exclude react-select comboboxes from standard fill — handled by fill() separately.
     */
    findFields() {
      return super.findFields().filter(el => !el.classList.contains("select__input"));
    }

    async fill() {
      const result = await super.fill();
      const { FormFiller } = ns;
      const overrides = this.customMappings();

      // Fill Greenhouse react-select comboboxes (EEO + custom questions)
      const comboboxes = Array.from(document.querySelectorAll("input.select__input"));
      for (const el of comboboxes) {
        const resolved = this.resolveField(el, overrides);
        if (!resolved?.value) { result.unmapped.push(el); continue; }
        const ok = await this._fillGhCombo(el, resolved.value);
        if (ok) result.filled.push({ el, key: resolved.key, value: resolved.value });
        else result.unmapped.push(el);
      }

      return result;
    }

    /**
     * Fill a Greenhouse react-select combobox by simulating a click to open
     * the menu, then clicking the matching option.
     */
    async _fillGhCombo(el, value) {
      if (!el || value == null || value === "") return false;
      const { FormFiller } = ns;

      // Click to open the dropdown
      try { el.focus(); } catch (_) {}
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
      el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true, view: window, button: 0 }));
      el.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true, view: window, button: 0 }));

      // Wait for the menu to appear (up to 2s)
      let menu = null;
      for (let i = 0; i < 20; i++) {
        menu = document.querySelector("[class*='select__menu']");
        if (menu) break;
        await new Promise(r => setTimeout(r, 100));
      }
      if (!menu) return false;

      // Build candidate values via synonym expansion
      const targets = (FormFiller.expandSynonyms || (v => [v]))(String(value).toLowerCase().trim());
      const options = Array.from(menu.querySelectorAll("[class*='select__option']"));

      let matched = null;
      // Pass 1: exact text match
      outer: for (const target of targets) {
        for (const opt of options) {
          if ((opt.textContent || "").toLowerCase().trim() === target) { matched = opt; break outer; }
        }
      }
      // Pass 2: substring (target or option text >= 3 chars)
      if (!matched) {
        outer2: for (const target of targets) {
          if (target.length < 3) continue;
          for (const opt of options) {
            const t = (opt.textContent || "").toLowerCase().trim();
            if (t && (t.includes(target) || target.includes(t))) { matched = opt; break outer2; }
          }
        }
      }

      if (!matched) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return false;
      }

      matched.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
      matched.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true, view: window, button: 0 }));
      matched.click();
      await new Promise(r => setTimeout(r, 50));
      return true;
    }
  }

  ns.GreenhouseSite = GreenhouseSite;
})(typeof window !== "undefined" ? window : globalThis);

