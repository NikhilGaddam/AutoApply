// Low-level helpers that set values on inputs in a framework-friendly way
// (React/Vue listen to the native `input`/`change` events, not direct .value assignment).
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const valueSetter = Object.getOwnPropertyDescriptor(el, "value")?.set;
    if (valueSetter && setter && valueSetter !== setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fillInput(el, value) {
    if (el == null || value == null || value === "") return false;
    setNativeValue(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function fillTextarea(el, value) {
    return fillInput(el, value);
  }

  function fillSelect(el, value) {
    if (!el || value == null || value === "") return false;
    const target = String(value).toLowerCase().trim();
    let matched = null;
    for (const opt of el.options) {
      const t = (opt.text || "").toLowerCase().trim();
      const v = (opt.value || "").toLowerCase().trim();
      if (t === target || v === target) { matched = opt; break; }
    }
    if (!matched) {
      for (const opt of el.options) {
        const t = (opt.text || "").toLowerCase().trim();
        if (t && (t.includes(target) || target.includes(t))) { matched = opt; break; }
      }
    }
    if (!matched) return false;
    el.value = matched.value;
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
    // Pass 2: substring match — but only when target is long enough that
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
        const group = el.closest("ul, fieldset, .application-question, .form-group, [role='radiogroup']") || el.parentElement;
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

  ns.FormFiller = { fillField, isFillable, setNativeValue };
})(typeof window !== "undefined" ? window : globalThis);
