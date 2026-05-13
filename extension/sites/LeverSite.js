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
      // Lever splits the page into multiple <form>s: the main application form
      // (id=application-form) and a separate one for the demographic survey.
      // Include every form on the page so we cover both.
      const forms = Array.from(document.querySelectorAll("form"));
      const scope = forms.length ? forms : [document];
      const { FormFiller } = ns;
      const seen = new Set();
      const all = [];
      for (const f of scope) {
        for (const el of f.querySelectorAll("input, select, textarea")) {
          if (seen.has(el)) continue;
          if (!FormFiller.isFillable(el)) continue;
          seen.add(el);
          all.push(el);
        }
      }
      return all;
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
