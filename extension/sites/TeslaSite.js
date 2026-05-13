// Tesla (tesla.com/careers) : Tesla's careers app uses a React form with dotted
// `name` attributes (e.g. personal.firstName, personal.profileLinks[0].link).
// The label-based matcher catches most fields, but selects (phoneType, country,
// profileLinks[0].type) need explicit mapping to avoid label collisions like
// "Contact Phone Type" matching the `/phone/` rule.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});
  const { BaseSite } = ns;

  class TeslaSite extends BaseSite {
    static id = "tesla";
    static label = "Tesla";

    static hostMatches(url) {
      return /(^|\.)tesla\.com$/i.test(url.hostname) && /\/careers\//i.test(url.pathname);
    }

    customMappings() {
      const map = new Map();
      const all = (name, key) => {
        document.querySelectorAll(`[name="${CSS.escape(name)}"]`).forEach((el) => map.set(el, key));
      };
      const byName = (name, key) => {
        const el = document.querySelector(`[name="${CSS.escape(name)}"]`);
        if (el) map.set(el, key);
      };
      // Step 1 : personal
      byName("personal.firstName", "firstName");
      byName("personal.lastName", "lastName");
      byName("personal.email", "email");
      byName("personal.phone", "phone");
      byName("personal.phoneType", "phoneType");
      byName("personal.country", "address.country");
      byName("personal.profileLinks[0].link", "links.linkedin");
      byName("personal.profileLinks[0].type", "defaultProfileLinkType");
      // Step 2 : legal acknowledgment. Radio groups: every input shares the
      // same name, so all() maps each option so fillField can locate the group.
      byName("legal.legalNoticePeriod", "noticePeriod");
      all("legal.legalImmigrationSponsorship", "workAuthorization.requiresSponsorship");
      all("legal.legalFormerTeslaEmployee", "previouslyEmployed");
      all("legal.legalFormerTeslaInternOrContractor", "previouslyEmployed");
      byName("legal.legalAcknowledgmentName", "fullName");
      // Step 3 — EEO. Selects use Tesla-specific option text, so map via
      // the profile keys that hold the canonical answers. The select-text
      // matcher in FormFiller handles synonyms via the EEO_SYNONYMS table
      // (Man↔Male, "I am not a veteran"↔"I am not a protected veteran", etc.).
      byName("eeo.eeoGender", "demographics.gender");
      byName("eeo.eeoVeteranStatus", "demographics.veteranStatus");
      byName("eeo.eeoRaceEthnicity", "demographics.race");
      byName("eeo.eeoDisabilityStatus", "demographics.disabilityStatus");
      byName("eeo.eeoDisabilityStatusName", "fullName");
      // Intentionally left for user review (consent / preference questions):
      //   legal.legalConsiderOtherPositions, legal.legalReceiveNotifications,
      //   legal.legalAcknowledgment, eeo.eeoAcknowledgment
      return map;
    }
  }

  ns.TeslaSite = TeslaSite;
})(typeof window !== "undefined" ? window : globalThis);
