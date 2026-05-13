// Workday (myworkdayjobs.com) — stub. Workday uses heavy data-automation-id attrs
// across multi-step forms. Extend mappings per step as needed.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});
  const { BaseSite } = ns;

  class WorkdaySite extends BaseSite {
    static id = "workday";
    static label = "Workday";

    static hostMatches(url) {
      return /myworkdayjobs\.com$/i.test(url.hostname) || /\.workday\.com$/i.test(url.hostname);
    }

    customMappings() {
      const map = new Map();
      const byAuto = (id, key) => {
        const el = document.querySelector(`[data-automation-id="${id}"]`);
        if (el) map.set(el, key);
      };
      byAuto("legalNameSection_firstName", "firstName");
      byAuto("legalNameSection_lastName", "lastName");
      byAuto("email", "email");
      byAuto("phone-number", "phone");
      byAuto("addressSection_addressLine1", "address.line1");
      byAuto("addressSection_city", "address.city");
      byAuto("addressSection_countryRegion", "address.state");
      byAuto("addressSection_postalCode", "address.postalCode");
      return map;
    }
  }

  ns.WorkdaySite = WorkdaySite;
})(typeof window !== "undefined" ? window : globalThis);
