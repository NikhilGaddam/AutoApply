// Lever (jobs.lever.co) — Lever uses a fairly consistent <li>-based form with
// .application-label and named inputs (name="name", name="email", name="phone",
// name="location", name="org", name="urls[LinkedIn]" etc).
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});
  const { BaseSite } = ns;

  class LeverSite extends BaseSite {
    static id = "lever";
    static label = "Lever";

    static hostMatches(url) {
      return /(^|\.)jobs\.lever\.co$/i.test(url.hostname);
    }

    findFields() {
      // Scope to the application form when present
      const form = document.querySelector("form#application-form, form.application-form, form[action*='apply']") || document;
      const selectors = "input, select, textarea";
      const { FormFiller } = ns;
      return Array.from(form.querySelectorAll(selectors)).filter(FormFiller.isFillable);
    }

    customMappings() {
      const map = new Map();
      const byName = (name, key) => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el) map.set(el, key);
      };
      // Lever's canonical field names
      byName("name", "fullName");
      byName("email", "email");
      byName("phone", "phone");
      byName("location", "currentLocation");
      byName("org", "currentCompany");
      byName("urls[LinkedIn]", "links.linkedin");
      byName("urls[GitHub]", "links.github");
      byName("urls[Portfolio]", "links.portfolio");
      byName("urls[Other]", "links.website");
      return map;
    }
  }

  ns.LeverSite = LeverSite;
})(typeof window !== "undefined" ? window : globalThis);
