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
     * Fill a Greenhouse react-select combobox using keyboard navigation.
     * Focuses the input, presses ArrowDown to open the menu, navigates
     * to the matching option with ArrowDown, then confirms with Enter.
     * This avoids isTrusted issues with programmatic click events.
     */
    async _fillGhCombo(el, value) {
      if (!el || value == null || value === "") return false;
      const { FormFiller } = ns;

      const targets = (FormFiller.expandSynonyms || (v => [v]))(String(value).toLowerCase().trim());
      const isMatch = (text) => {
        const t = (text || "").toLowerCase().trim();
        for (const target of targets) {
          if (t === target) return true;
          if (target.length >= 3 && (t.includes(target) || target.includes(t))) return true;
        }
        return false;
      };

      const dispatchKey = (key, keyCode) => el.dispatchEvent(
        new KeyboardEvent("keydown", { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true })
      );

      try { el.focus(); } catch (_) {}
      await new Promise(r => setTimeout(r, 100));

      // ArrowDown opens the menu and focuses the first option
      dispatchKey("ArrowDown", 40);

      // Wait for menu to appear (up to 2s)
      let menu = null;
      for (let i = 0; i < 20; i++) {
        menu = document.querySelector("[class*='select__menu']");
        if (menu) break;
        await new Promise(r => setTimeout(r, 100));
      }
      if (!menu) return false;

      // Navigate options with ArrowDown until target is focused, then Enter
      for (let i = 0; i < 10; i++) {
        const focused = menu.querySelector("[class*='select__option--is-focused'], [class*='option--is-focused']");
        if (focused && isMatch(focused.textContent)) {
          dispatchKey("Enter", 13);
          await new Promise(r => setTimeout(r, 100));
          return true;
        }
        dispatchKey("ArrowDown", 40);
        await new Promise(r => setTimeout(r, 80));
      }

      dispatchKey("Escape", 27);
      return false;
    }
  }

  ns.GreenhouseSite = GreenhouseSite;
})(typeof window !== "undefined" ? window : globalThis);

