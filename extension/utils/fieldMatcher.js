// FieldMatcher: derives a profile key from a form field's surrounding text/attrs.
// Pure algorithm : no AI. Uses ordered regex rules over a normalized label string.
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
    { key: "currentLocation",  patterns: [/\bcurrent[\s_-]*location\b/, /\bcity[\s_-]*\/[\s_-]*state/, /\bwhere are you (located|based)\b/] },
    // Generic "what is your location?" dropdowns usually expect a country.
    { key: "address.country",  patterns: [/\bwhat is your location\b/, /^location$/, /\byour location\b/] },

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
    { key: "demographics.gender",         patterns: [/\bgender\b/, /\bgender[\s_-]*identity\b/] },
    { key: "demographics.race",           patterns: [/\brace\b/, /\brace[\s_-]*\/[\s_-]*ethnicit/, /\bracial[\s_-]*identity\b/] },
    { key: "demographics.ethnicity",      patterns: [/\bethnicit/, /\bhispanic\b/, /\blatino\b/] },
    { key: "demographics.veteranStatus",  patterns: [/\bveteran\b/, /\bmilitary[\s_-]*status\b/] },
    { key: "demographics.disabilityStatus",patterns: [/\bdisabilit/]},

    { key: "previouslyEmployed", patterns: [/\bpreviously[\s_-]*employed\b/, /\bever[\s_-]*(been[\s_-]*)?(employed|worked)[\s_-]*(by|at|for)\b/, /\bworked[\s_-]*(here|with[\s_-]*us)\b/] },
    { key: "referredByEmployee", patterns: [/\breferred[\s_-]*by\b/, /\bemployee[\s_-]*referral\b/] },
    { key: "relativesAtCompany", patterns: [/\brelatives\b/, /\bfamily members?\b.*\bwork\b/, /\bdo you have relatives\b/] },
    { key: "over18",             patterns: [/\bover[\s_-]*18\b/, /\b18[\s_-]*years[\s_-]*or[\s_-]*older\b/] }
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
    // Helper: get innerText of a labelling node, but with the field itself
    // (and any descendant form controls) stripped, so a <label> wrapping a
    // <select> doesn't leak its 250 option strings into the matcher.
    const cleanText = (node) => {
      if (!node) return "";
      const clone = node.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, option, ul, ol").forEach((n) => n.remove());
      return clone.innerText || clone.textContent || "";
    };
    // 1. <label for="id">
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) parts.push(cleanText(lbl));
    }
    // 2. Ancestor <label>
    const parentLabel = el.closest("label");
    if (parentLabel) parts.push(cleanText(parentLabel));
    // 3. aria-label / aria-labelledby
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) parts.push(cleanText(n));
      });
    }
    // 4. placeholder, name, id
    parts.push(el.getAttribute("placeholder") || "");
    parts.push(el.getAttribute("name") || "");
    parts.push(el.id || "");
    // 5. Walk up looking for ANY question-wrapper that carries the actual label.
    //    Lever wraps each question in `li.application-question` (or `div.application-question`
    //    for the demographic survey) whose `.application-label` OR plain `<label>` child
    //    holds the human-readable question. For checkbox groups, each option has its own
    //    inner <li>, so `closest('li')` returns the wrong scope : we must skip past it.
    const QUESTION_SEL = "li.application-question, .application-question, fieldset, .form-group, .field";
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.matches?.(QUESTION_SEL)) {
        const lbl = node.querySelector(":scope > .application-label, :scope > label, :scope > .label, :scope > legend, :scope > .question, .application-label, label.application-label, legend, .question");
        if (lbl) {
          // Only take the first text node / clone without nested inputs to avoid picking up option labels
          const clone = lbl.cloneNode(true);
          clone.querySelectorAll("input, select, textarea, ul, ol").forEach(n => n.remove());
          const text = (clone.innerText || "").trim();
          if (text) { parts.push(text); break; }
        }
      }
      node = node.parentElement;
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
