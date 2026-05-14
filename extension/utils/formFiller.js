// Low-level helpers that set values on inputs in a framework-friendly way
// (React/Vue listen to the native `input`/`change` events, not direct .value assignment).
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});

  function setNativeValue(el, value) {
    // From an extension isolated world, calling the prototype setter (the
    // original React interop trick) bypasses React's own-property tracker
    // and React never sees the change. Instead, call the own-property setter
    // directly (React's tracker closure) — Chrome allows cross-world calls
    // on DOM element own-property setters. Fall back to direct assignment if
    // the own setter is cross-world inaccessible.
    const ownSetter = Object.getOwnPropertyDescriptor(el, "value")?.set;
    const protoSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (ownSetter && protoSetter && ownSetter !== protoSetter) {
      // React tracker is present. Call native (proto) setter first to set the
      // underlying C++ value, then React's tracker to update internal state.
      try { protoSetter.call(el, value); } catch (_) {}
      try { ownSetter.call(el, value); } catch (_) { el.value = value; }
    } else {
      el.value = value;
    }
  }

  function fillInput(el, value) {
    if (el == null || value == null || value === "") return false;
    // Focus the field first so React marks it as "touched/active". Without
    // this, Workday's password inputs silently reject programmatic value changes.
    try { el.focus(); } catch (_) {}
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a", keyCode: 65 }));
    } catch (_) {}
    setNativeValue(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try { el.blur(); } catch (_) {}
    return true;
  }

  function fillTextarea(el, value) {
    return fillInput(el, value);
  }

  // Fill a field via the background service worker's chrome.scripting.executeScript
  // (world: "MAIN"). Necessary for React-controlled password inputs where the
  // own-property tracker is not callable from an isolated content-script world.
  // Returns a Promise<boolean>.
  function fillInputMainWorld(el, value) {
    const autoId = el && el.getAttribute && el.getAttribute("data-automation-id");
    if (!autoId) return Promise.resolve(fillInput(el, value));
    return new Promise((resolve) => {
      // 3-second safety timeout: if the background service worker doesn't
      // respond (e.g. it was killed and is waking up), resolve false instead
      // of hanging the inflight lock forever.
      const bail = setTimeout(() => resolve(false), 3000);
      chrome.runtime.sendMessage(
        { type: "fillFieldMainWorld", selector: `[data-automation-id="${autoId}"]`, value: String(value) },
        (resp) => {
          clearTimeout(bail);
          if (chrome.runtime.lastError) { resolve(false); return; }
          resolve(!!(resp && resp.ok));
        }
      );
    });
  }

  // Synonyms for option matching when the page uses different vocabulary than
  // the profile (e.g. Tesla EEO uses "Male"/"Female" while the profile stores
  // "Man"/"Woman", or "I am not a protected veteran" vs "I am not a veteran").
  const SELECT_SYNONYMS = [
    [/^man$/i, ["male"]],
    [/^woman$/i, ["female"]],
    [/^non-?binary$/i, ["non-binary", "nonbinary", "non binary"]],
    [/^not hispanic or latino$/i, ["no"]],
    [/^i am not a veteran$/i, ["i am not a protected veteran", "not a veteran", "non-veteran", "no"]],
    [/^i am a veteran$/i, ["i identify as one or more of the classifications of protected veterans", "yes"]],
    [/^no,? i do not have a disability$/i, ["no", "no, i do not have a disability", "no disability"]],
    [/^yes,? i have a disability$/i, ["yes", "yes, i have a disability"]],
    [/^prefer not to (say|answer|disclose)$/i, ["choose not to disclose", "i choose not to disclose", "decline to state", "do not wish to answer"]]
  ];
  function expandSynonyms(target) {
    const out = [target];
    for (const [re, alts] of SELECT_SYNONYMS) {
      if (re.test(target)) {
        for (const a of alts) if (!out.includes(a)) out.push(a);
      }
    }
    return out;
  }

  function fillSelect(el, value) {
    if (!el || value == null || value === "") return false;
    const targets = expandSynonyms(String(value).toLowerCase().trim());
    let matched = null;
    // Pass 1: exact text or value match for any target / synonym.
    outer: for (const target of targets) {
      for (const opt of el.options) {
        const t = (opt.text || "").toLowerCase().trim();
        const v = (opt.value || "").toLowerCase().trim();
        if (t === target || v === target) { matched = opt; break outer; }
      }
    }
    // Pass 2: substring match (length ≥3 to avoid "man" matching "woman").
    if (!matched) {
      outer2: for (const target of targets) {
        if (target.length < 3) continue;
        for (const opt of el.options) {
          const t = (opt.text || "").toLowerCase().trim();
          if (t && (t.includes(target) || target.includes(t))) { matched = opt; break outer2; }
        }
      }
    }
    if (!matched) return false;
    setNativeValue(el, matched.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function fillCheckboxGroup(container, value) {
    if (!container || value == null) return false;
    const target = String(value).toLowerCase().trim();
    const boxes = container.querySelectorAll('input[type="checkbox"], input[type="radio"]');
    // Pass 1: exact match
    for (const box of boxes) {
      const lbl = box.closest("label") || box.parentElement;
      const text = (lbl?.innerText || box.value || "").toLowerCase().trim();
      if (text === target) {
        if (!box.checked) box.click();
        return true;
      }
    }
    // Pass 2: substring match : but only when target is long enough that
    // "woman".includes("man") style false positives are unlikely.
    if (target.length >= 4) {
      for (const box of boxes) {
        const lbl = box.closest("label") || box.parentElement;
        const text = (lbl?.innerText || box.value || "").toLowerCase().trim();
        if (text && (text.includes(target) || target.includes(text))) {
          if (!box.checked) box.click();
          return true;
        }
      }
    }
    return false;
  }

  function fillField(el, value) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();

    if (tag === "select") return fillSelect(el, value);
    if (tag === "textarea") return fillTextarea(el, value);
    if (tag === "input") {
      if (type === "checkbox" || type === "radio") {
        // Walk up to the nearest grouping element
        const group = el.closest("ul, fieldset, .application-question, .form-group, .tds-form-input-group, .tds-form-item, [role='radiogroup']") || el.parentElement;
        return fillCheckboxGroup(group, value);
      }
      if (type === "file") return false; // can't be programmatically filled
      return fillInput(el, value);
    }
    if (el.isContentEditable) {
      el.textContent = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  function isFillable(el) {
    if (!el || !el.tagName) return false;
    if (el.disabled || el.readOnly) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return !["hidden", "submit", "button", "image", "reset"].includes(type);
    }
    return ["select", "textarea"].includes(tag) || el.isContentEditable;
  }

  ns.FormFiller = { fillField, isFillable, setNativeValue, fillInputMainWorld, expandSynonyms };
})(typeof window !== "undefined" ? window : globalThis);
