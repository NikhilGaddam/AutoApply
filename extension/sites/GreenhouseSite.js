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
      byId("country", "address.country");
      byId("question_15996710008", "workAuthorization.requiresSponsorship");
      byId("question_15996711008", "relativesAtCompany");
      byId("gender", "demographics.gender");
      byId("hispanic_ethnicity", "demographics.ethnicity");
      byId("race", "demographics.race");
      byId("veteran_status", "demographics.veteranStatus");
      byId("disability_status", "demographics.disabilityStatus");
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
     * Fill a Greenhouse react-select combobox by calling selectOption() directly
     * on the React fiber component instance. Runs via chrome.scripting.executeScript
     * (world: MAIN) because the isolated content-script world cannot dispatch
     * trusted events or call React methods defined in the page context.
     */
    async _fillGhCombo(el, value) {
      if (!el || value == null || value === "" || !el.id) return false;
      const { FormFiller } = ns;

      const targets = (FormFiller.expandSynonyms || (v => [v]))(String(value).toLowerCase().trim());

      return new Promise(resolve => {
        const bail = setTimeout(() => resolve(false), 3000);
        chrome.runtime.sendMessage(
          { type: "ghSelectOption", inputId: el.id, targets, value: String(value) },
          resp => {
            clearTimeout(bail);
            if (chrome.runtime.lastError) { resolve(false); return; }
            resolve(!!(resp?.ok));
          }
        );
      });
    }
  }

  ns.GreenhouseSite = GreenhouseSite;
})(typeof window !== "undefined" ? window : globalThis);

