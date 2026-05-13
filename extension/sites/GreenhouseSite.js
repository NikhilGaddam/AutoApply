// Greenhouse (boards.greenhouse.io) : stub with the canonical field names.
// Extend customMappings as you encounter more form variants.
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
      byId("phone", "phone");
      // Common Greenhouse URL question IDs use job_application[answers_attributes]
      // and vary by board : generic matching will catch those.
      return map;
    }
  }

  ns.GreenhouseSite = GreenhouseSite;
})(typeof window !== "undefined" ? window : globalThis);
