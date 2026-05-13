// FieldMatcher: derives a profile key from a form field's surrounding text/attrs.
// Pure algorithm — no AI. Uses ordered regex rules over a normalized label string.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});

  // Ordered: first match wins. More specific patterns must come before generic ones.
  // Each rule: { key, patterns: [RegExp], excludes?: [RegExp] }
  const RULES = [
    { key: "fullName",        patterns: [/\bfull[\s_-]*name\b/, /^name$/, /\bcandidate[\s_-]*name\b/] },
    { key: "firstName",       patterns: [/\bfirst[\s_-]*name\b/, /\bgiven[\s_-]*name\b/, /\bfname\b/] },
    { key: "lastName",        patterns: [/\blast[\s_-]*name\b/, /\bsurname\b/, /\bfamily[\s_-]*name\b/, /\blname\b/] },
    { key: "preferredName",   patterns: [/\bpreferred[\s_-]*(first[\s_-]*)?name\b/, /\bnickname\b/] },
    { key: "pronouns",        patterns: [/\bpronoun/] },

    { key: "email",           patterns: [/\bemail\b/, /\be-?mail[\s_-]*address\b/] },
    { key: "phone",           patterns: [/\bphone\b/, /\bmobile\b/, /\btelephone\b/, /\bcontact[\s_-]*number\b/] },

    { key: "address.line1",    patterns: [/\baddress[\s_-]*(line[\s_-]*1|1)?\b/, /\bstreet\b/] },
    { key: "address.city",     patterns: [/\bcity\b/, /\btown\b/] },
    { key: "address.state",    patterns: [/\bstate\b/, /\bprovince\b/, /\bregion\b/] },
    { key: "address.postalCode", patterns: [/\bzip\b/, /\bpostal[\s_-]*code\b/, /\bpost[\s_-]*code\b/] },
    { key: "address.country",  patterns: [/\bcountry\b/] },
    { key: "currentLocation",  patterns: [/\bcurrent[\s_-]*location\b/, /\bcity[\s_-]*\/[\s_-]*state/, /\blocation\b/, /\bwhere are you (located|based)\b/] },

    { key: "links.linkedin",   patterns: [/\blinked[\s_-]*in\b/] },
    { key: "links.github",     patterns: [/\bgithub\b/, /\bgit[\s_-]*hub\b/] },
    { key: "links.portfolio",  patterns: [/\bportfolio\b/, /\bpersonal[\s_-]*site\b/] },
    { key: "links.website",    patterns: [/\bwebsite\b/, /\bother[\s_-]*website\b/, /\bpersonal[\s_-]*url\b/] },
    { key: "links.twitter",    patterns: [/\btwitter\b/, /\bx\.com\b/] },

    { key: "currentCompany",   patterns: [/\bcurrent[\s_-]*(company|employer)\b/, /\bemployer\b/, /^company$/] },
    { key: "currentTitle",     patterns: [/\bcurrent[\s_-]*(title|position|role)\b/, /\bjob[\s_-]*title\b/] },
    { key: "yearsOfExperience",patterns: [/\byears[\s_-]*of[\s_-]*experience\b/, /\bYOE\b/, /\bexperience[\s_-]*\(years\)/] },
    { key: "desiredSalary",    patterns: [/\bsalary\b/, /\bcompensation[\s_-]*expectation/, /\bexpected[\s_-]*(pay|salary|compensation)\b/] },
    { key: "noticePeriod",     patterns: [/\bnotice[\s_-]*period\b/, /\bavailability[\s_-]*to[\s_-]*start\b/] },

    { key: "workAuthorization.authorizedToWork", patterns: [/\bauthori[sz]ed[\s_-]*to[\s_-]*work\b/, /\blegally[\s_-]*authori[sz]ed\b/, /\bright[\s_-]*to[\s_-]*work\b/] },
    { key: "workAuthorization.requiresSponsorship", patterns: [/\b(visa[\s_-]*)?sponsorship\b/, /\brequire[\s_-]*sponsorship\b/] },
    { key: "workAuthorization.gender", patterns: [/\bgender\b/] },
    { key: "workAuthorization.race",   patterns: [/\brace\b/, /\bethnicit/] },
    { key: "workAuthorization.veteranStatus",   patterns: [/\bveteran\b/] },
    { key: "workAuthorization.disabilityStatus",patterns: [/\bdisabilit/] }
  ];

  function normalize(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .replace(/[*✱]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Collects label-like text around a form element.
   */
  function collectLabelText(el) {
    if (!el) return "";
    const parts = [];
    // 1. <label for="id">
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) parts.push(lbl.innerText);
    }
    // 2. Ancestor <label>
    const parentLabel = el.closest("label");
    if (parentLabel) parts.push(parentLabel.innerText);
    // 3. aria-label / aria-labelledby
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) parts.push(n.innerText);
      });
    }
    // 4. placeholder, name, id
    parts.push(el.getAttribute("placeholder") || "");
    parts.push(el.getAttribute("name") || "");
    parts.push(el.id || "");
    // 5. Nearby preceding text in parent (Lever uses <div class="application-label">)
    const li = el.closest("li, .application-question, .form-group, .field, fieldset");
    if (li) {
      const lblNode = li.querySelector(".application-label, .label, legend, .question");
      if (lblNode) parts.push(lblNode.innerText);
    }
    return normalize(parts.join(" "));
  }

  /**
   * Returns the profile key (string, possibly dotted) for the field, or null.
   */
  function matchField(el) {
    const text = collectLabelText(el);
    if (!text) return null;
    for (const rule of RULES) {
      for (const re of rule.patterns) {
        if (re.test(text)) return rule.key;
      }
    }
    return null;
  }

  function getProfileValue(profile, key) {
    if (!key) return undefined;
    return key.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), profile);
  }

  ns.FieldMatcher = { matchField, collectLabelText, getProfileValue, normalize, RULES };
})(typeof window !== "undefined" ? window : globalThis);
