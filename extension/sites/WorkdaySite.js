// Workday (myworkdayjobs.com) — multi-step flow that gates the application
// behind a sign-in / create-account step. We auto-fill credentials from the
// profile (`profile.account.{email,password}`) and step through each page.
//
// Steps (CVS / typical Workday):
//   1. Create Account / Sign In
//   2. My Information   (legal name, address, phone)
//   3. My Experience    (work history, education, resume, links)
//   4-5. Application Questions  (custom screening, work auth)
//   6. Voluntary Disclosures
//   7. Self Identify    (EEO)
//   8. Review           (submit)
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
        // Workday inputs may use data-automation-id, id, or name with the
        // same logical identifier. Try all three.
        const el =
          document.querySelector(`[data-automation-id="${id}"]`) ||
          document.getElementById(id) ||
          document.querySelector(`[name="${id}"]`);
        if (el) map.set(el, key);
      };
      // ----- Sign In / Create Account (step 1) -----
      byAuto("email", "account.email");
      byAuto("password", "account.password");
      // For Create Account form, map email/password/verify fields directly.
      const createFormVisible = !!document.querySelector('[data-automation-id="verifyPassword"]');
      if (createFormVisible) {
        const emailEl2 = document.querySelector('[data-automation-id="email"]');
        const pwEl2 = document.querySelector('[data-automation-id="password"]');
        const verifyEl = document.querySelector('[data-automation-id="verifyPassword"]');
        if (emailEl2) map.set(emailEl2, "account.email");
        if (pwEl2) map.set(pwEl2, "account.passwordCreate");
        if (verifyEl) map.set(verifyEl, "account.passwordCreate");
      }
      byAuto("verifyPassword", "account.passwordCreate");
      // ----- My Information (step 2) -----
      // Workday uses two automation-id naming conventions depending on the
      // tenant version: underscore-style and double-dash-style.
      byAuto("legalNameSection_firstName", "firstName");
      byAuto("legalNameSection_lastName", "lastName");
      byAuto("preferredNameSection_firstName", "preferredName");
      byAuto("preferredNameSection_lastName", "lastName");
      byAuto("name--legalName--firstName", "firstName");
      byAuto("name--legalName--lastName", "lastName");
      byAuto("name--preferredName--firstName", "preferredName");
      byAuto("name--preferredName--lastName", "lastName");
      byAuto("addressSection_addressLine1", "address.line1");
      byAuto("addressSection_addressLine2", "address.line2");
      byAuto("addressSection_city", "address.city");
      byAuto("addressSection_countryRegion", "address.state");
      byAuto("addressSection_postalCode", "address.postalCode");
      byAuto("address--addressLine1", "address.line1");
      byAuto("address--addressLine2", "address.line2");
      byAuto("address--city", "address.city");
      byAuto("address--postalCode", "address.postalCode");
      byAuto("countryDropdown", "address.country");
      // Phone: keep local + country code in dedicated fields. The generic
      // "phone" key would leak "+1 571-635-2506" into all three Workday
      // phone inputs (country code, number, extension).
      byAuto("phone-number", "phoneLocal");
      byAuto("phoneNumber", "phoneLocal");
      byAuto("phoneNumber--phoneNumber", "phoneLocal");
      byAuto("phoneNumber--extension", "phoneExtension");
      byAuto("phoneNumber--countryPhoneCode", "phoneCountryCode");
      // ----- Self Identify (step 7) -----
      byAuto("personalInformationGender", "demographics.gender");
      byAuto("personalInformationRace", "demographics.race");
      byAuto("personalInformationEthnicity", "demographics.ethnicity");
      byAuto("personalInformationVeteranStatus", "demographics.veteranStatus");
      byAuto("personalInformationDisabilityStatus", "demographics.disabilityStatus");
      return map;
    }

    async fill() {
      // Run one tick now so caller (content.js) gets immediate result.
      const result = await this._tick();
      // Start a persistent background driver that re-ticks every ~700ms.
      // Workday is an SPA that lazily renders sign-in tiles, auth forms,
      // and each step's form. The base MutationObserver in content.js does
      // not match Workday's wrappers, so we drive the flow ourselves.
      this._ensureDriver();
      return result;
    }

    /**
     * One pass: detect what step we're on, click the appropriate tile if
     * any, fill any currently-visible inputs, drive Workday dropdowns, and
     * (only on the auth gate) submit. Never clicks Next/Submit on regular
     * form steps : the user keeps that responsibility.
     */
    async _tick() {
      // Diagnostic: stamp document.documentElement so page-world CDP probes
      // can confirm the driver is alive and see what step it last saw.
      try {
        const d = document.documentElement;
        d.setAttribute("data-autoapply-tick", String(Date.now()));
        const tileVisible = !!document.querySelector('[data-automation-id="SignInWithEmailButton"]');
        const emailVisible = !!document.querySelector('[data-automation-id="email"]');
        const nextVisible = !!document.querySelector('[data-automation-id="pageFooterNextButton"]');
        d.setAttribute("data-autoapply-step",
          nextVisible ? "form" : (emailVisible ? "auth" : (tileVisible ? "tiles" : "unknown")));
      } catch (_) {}

      // ── sessionStorage helpers (survive same-tab page navigations) ─────────
      const SS = {
        get: (k) => { try { return sessionStorage.getItem("aa_" + k); } catch (_) { return null; } },
        set: (k, v) => { try { sessionStorage.setItem("aa_" + k, String(v)); } catch (_) {} },
        del: (k) => { try { sessionStorage.removeItem("aa_" + k); } catch (_) {} }
      };

      // Remember the original apply URL so we can return to it if auth
      // redirects us to /userHome. Use sessionStorage so it persists across
      // page navigations within the same tab.
      if (/\/apply\b/.test(location.pathname) && !SS.get("returnUrl")) {
        SS.set("returnUrl", location.href);
      }
      // On /login?redirect=... Workday carries the apply URL in the param.
      if (/\/login\b/.test(location.pathname) && !SS.get("returnUrl")) {
        try {
          const redir = new URLSearchParams(location.search).get("redirect");
          if (redir) SS.set("returnUrl", location.origin + decodeURIComponent(redir));
        } catch (_) {}
      }
      // After account creation Workday may land on /userHome. Navigate back.
      if (/userHome/i.test(location.pathname)) {
        const ret = SS.get("returnUrl");
        if (ret) { location.href = ret; return; }
      }
      const landing = document.querySelector('[data-automation-id="applyManually"]');
      if (landing && !this._isAuthOrFormStep()) {
        await this._realClick(landing);
        await new Promise((r) => setTimeout(r, 1200));
      }
      // 2. Sign-in tile selector (Apple / Google / LinkedIn / Email).
      const signInTile = document.querySelector('[data-automation-id="SignInWithEmailButton"]')
        || Array.from(document.querySelectorAll("button, a"))
            .find((b) => /sign in with email/i.test((b.innerText || "").trim()));
      const onAuthForm = !!(document.querySelector('[data-automation-id="signInSubmitButton"]') ||
                            document.querySelector('[data-automation-id="createAccountSubmitButton"]'));
      if (signInTile && !onAuthForm && !document.querySelector('[data-automation-id="email"]')) {
        await this._realClick(signInTile);
        await new Promise((r) => setTimeout(r, 1200));
      }

      // 3. Fill all currently-visible fields via the standard pipeline.
      const result = await super.fill();

      // 3b. Workday's Country / State / Phone Type are custom button-widgets.
      await this._fillWorkdayDropdowns();

      // 4. Auth gate ─ auto-submit Sign In or Create Account.
      // All state is in sessionStorage ("aa_*") so it survives cross-page
      // navigations within the same browser tab.
      //   aa_signInFailed  – "1" after sign-in returns error; skip future
      //                       sign-in attempts and go to Create Account.
      //   aa_createDone    – "1" after create-account submit fires.
      const signInBtn  = document.querySelector('[data-automation-id="signInSubmitButton"]');
      const createBtn  = document.querySelector('[data-automation-id="createAccountSubmitButton"]');
      const createLink = document.querySelector('[data-automation-id="createAccountLink"]');
      const emailEl    = document.querySelector('[data-automation-id="email"]');
      const pwEl       = document.querySelector('[data-automation-id="password"]');
      const verifyEl   = document.querySelector('[data-automation-id="verifyPassword"]');
      const consentBox = document.querySelector('[data-automation-id="createAccountCheckbox"]');

      // Sign-in form: try once per session; on failure wait 2s then switch to Create Account.
      if (signInBtn && !SS.get("signInFailed") && emailEl?.value && pwEl?.value) {
        await new Promise((r) => setTimeout(r, 600));
        try { document.activeElement?.blur?.(); } catch (_) {}
        document.documentElement.setAttribute("data-autoapply-auth", "submit:signin");
        const r = await this._submitAndWait(signInBtn, {
          successSel: '[data-automation-id="legalNameSection_firstName"], [data-automation-id="pageFooterNextButton"]',
          errorSel: '[data-automation-id="errorMessage"]',
          timeoutMs: 8000
        });
        document.documentElement.setAttribute("data-autoapply-auth", "result:" + r);
        if (r !== "success") {
          SS.set("signInFailed", "1");
          // Wait 2s then switch to Create Account.
          await new Promise((res) => setTimeout(res, 2000));
          const cl2 = document.querySelector('[data-automation-id="createAccountLink"]');
          if (cl2) { await this._realClick(cl2); await new Promise((res) => setTimeout(res, 1000)); }
        }
        return;
      }

      // If sign-in is known to fail and we're still on the sign-in form, switch over.
      if (signInBtn && SS.get("signInFailed") && createLink) {
        await this._realClick(createLink);
        await new Promise((r) => setTimeout(r, 1000));
        return;
      }

      // Create Account form: attempt once per session.
      if (createBtn && !SS.get("createDone") &&
          emailEl?.value && pwEl?.value && verifyEl?.value &&
          (!consentBox || consentBox.checked)) {
        SS.set("createDone", "1");
        await new Promise((r) => setTimeout(r, 600));
        try { document.activeElement?.blur?.(); } catch (_) {}
        document.documentElement.setAttribute("data-autoapply-auth", "submit:create");
        const r = await this._submitAndWait(createBtn, {
          successSel: '[data-automation-id="legalNameSection_firstName"], [data-automation-id="pageFooterNextButton"]',
          errorSel: '[data-automation-id="errorMessage"]',
          timeoutMs: 12000
        });
        document.documentElement.setAttribute("data-autoapply-auth", "result:" + r);
        if (r !== "success") {
          SS.del("createDone");
        } else {
          const usedEmail = emailEl?.value || "";
          SS.set("createEmail", usedEmail);
          document.documentElement.setAttribute("data-autoapply-create-email", usedEmail);
        }
        return;
      }

      // If create succeeded but we're back on the create form it means Workday
      // requires email verification before the session can proceed. Log once.
      if (createBtn && SS.get("createDone") && !SS.get("verifyNotified")) {
        SS.set("verifyNotified", "1");
        const usedEmail = SS.get("createEmail") || document.documentElement.getAttribute("data-autoapply-create-email") || "unknown";
        console.warn(`AutoApply: Workday requires email verification. Check Gmail for ${usedEmail} then click the link and refresh.`);
        document.documentElement.setAttribute("data-autoapply-auth", "waiting:email-verify");
      }

      // Refresh overlay marks after a tick.
      try {
        if (ns.Overlay && result?.filled?.length) {
          ns.Overlay.markFilled(result.filled.map((f) => f.el).filter(Boolean));
        }
        if (ns.Overlay && result?.unmapped?.length) {
          ns.Overlay.markUnmapped(result.unmapped);
        }
      } catch (_) {}

      return result;
    }

    _isAuthOrFormStep() {
      return !!(
        document.querySelector('[data-automation-id="signInSubmitButton"]') ||
        document.querySelector('[data-automation-id="createAccountSubmitButton"]') ||
        document.querySelector('[data-automation-id="pageFooterNextButton"]') ||
        document.querySelector('[data-automation-id="legalNameSection_firstName"]') ||
        document.querySelector('[data-automation-id="email"]') ||
        document.querySelector('[data-automation-id="SignInWithEmailButton"]')
      );
    }

    /**
     * Start a window-scoped polling loop that re-ticks every ~700ms for up
     * to 10 minutes. Idempotent: only one driver per tab. Persists across
     * content.js fill() calls (each call constructs a new WorkdaySite, but
     * the driver lives on window.__autoApplyWorkdayDriver).
     */
    _ensureDriver() {
      if (window.__autoApplyWorkdayDriver) return;
      window.__autoApplyWorkdayDriver = true;
      const startedAt = Date.now();
      const BUDGET_MS = 10 * 60 * 1000;
      const TICK_MS = 700;
      let inflight = false;
      const tick = async () => {
        if (Date.now() - startedAt > BUDGET_MS) {
          window.__autoApplyWorkdayDriver = false;
          return;
        }
        if (!inflight) {
          inflight = true;
          try {
            // Use a fresh instance each tick so customMappings() re-runs
            // against the currently-rendered DOM (each step has different
            // inputs).
            const fresh = new WorkdaySite(this.profile);
            await fresh._tick();
          } catch (e) {
            console.warn("AutoApply Workday driver tick error:", e);
          } finally {
            inflight = false;
          }
        }
        setTimeout(tick, TICK_MS);
      };
      setTimeout(tick, TICK_MS);
    }

    /**
     * Drive the auth gate: sign-in first, fall back to create-account if it
     * fails (error message or no nav after 4s). Idempotent within a fill().
     */
    async _attemptAuth() {
      const onSignInForm = !!document.querySelector('[data-automation-id="signInSubmitButton"]');
      const onCreateForm = !!document.querySelector('[data-automation-id="createAccountSubmitButton"]');

      if (onSignInForm) {
        const signInBtn = document.querySelector('[data-automation-id="signInSubmitButton"]');
        const advanced = await this._submitAndWait(signInBtn, {
          successSel: '[data-automation-id="legalNameSection_firstName"], [data-automation-id="pageFooterNextButton"]',
          errorSel: '[data-automation-id="errorMessage"], [role="alert"]',
          timeoutMs: 5000
        });
        if (advanced === "success") return;
        // Otherwise fall through to Create Account.
        const createLink = document.querySelector('[data-automation-id="createAccountLink"]');
        if (createLink) {
          await this._realClick(createLink);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      // Create Account form (may have arrived via signInLink fallback or directly).
      if (document.querySelector('[data-automation-id="createAccountSubmitButton"]')) {
        // Re-run super.fill() so verifyPassword + privacy checkbox get set.
        await super.fill();
        await new Promise((r) => setTimeout(r, 400));
        const createBtn = document.querySelector('[data-automation-id="createAccountSubmitButton"]');
        if (createBtn) {
          await this._submitAndWait(createBtn, {
            successSel: '[data-automation-id="legalNameSection_firstName"], [data-automation-id="pageFooterNextButton"]',
            errorSel: '[data-automation-id="errorMessage"], [role="alert"]',
            timeoutMs: 8000
          });
        }
      }
    }

    /**
     * Click a button via a faithful pointer+mouse+click event sequence and
     * wait for either a success or error indicator. Workday's submit buttons
     * appear to ignore bare HTMLElement.click() in some cases; dispatching
     * pointerdown/mousedown/pointerup/mouseup/click in order \u2014 with bubbles
     * and composed \u2014 reliably triggers their React onClick handlers.
     * Returns "success" | "error" | "timeout".
     */
    async _submitAndWait(btn, { successSel, errorSel, timeoutMs }) {
      const beforeUrl = location.href;
      document.documentElement.setAttribute("data-autoapply-submit", "clicking:" + (btn?.getAttribute("data-automation-id") || btn?.tagName));

      // Helper that polls for either success or error indicator. Returns
      // "success" | "error" | "timeout".
      const waitFor = async (ms) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
          await new Promise((r) => setTimeout(r, 200));
          if (successSel && document.querySelector(successSel)) return "success";
          if (location.href !== beforeUrl) return "success";
          if (errorSel) {
            const errs = document.querySelectorAll(errorSel);
            if (errs.length) {
              const txt = Array.from(errs).map((e) => (e.innerText || "").trim()).join(" | ");
              if (txt) return "error";
            }
          }
        }
        return "timeout";
      };

      // Strategy 1: faithful synthetic pointer/mouse/click sequence.
      await this._realClick(btn);
      let r = await waitFor(Math.min(timeoutMs, 3000));
      if (r !== "timeout") {
        document.documentElement.setAttribute("data-autoapply-submit", r);
        return r;
      }
      // Strategy 2: bare HTMLElement.click() (covers cases where React's
      // onClick listener checks isTrusted on PointerEvent but accepts the
      // browser's own click() invocation).
      try { btn.click(); } catch (_) {}
      r = await waitFor(Math.min(timeoutMs, 3000));
      if (r !== "timeout") {
        document.documentElement.setAttribute("data-autoapply-submit", r + ":fallback-click");
        return r;
      }
      // Strategy 3: HTMLFormElement.requestSubmit(btn) for type=submit
      // buttons inside a <form>. Triggers the form's submit listener with
      // the submitter set to the button.
      try {
        const f = btn.closest("form");
        if (f && typeof f.requestSubmit === "function") f.requestSubmit(btn);
      } catch (_) {}
      r = await waitFor(Math.min(timeoutMs, 3000));
      if (r !== "timeout") {
        document.documentElement.setAttribute("data-autoapply-submit", r + ":fallback-submit");
        return r;
      }
      // Strategy 4: focus the button and dispatch a keydown Enter. Some
      // React widgets register accessibility key handlers (Space / Enter on
      // a focused button) that synthesize the activation event differently
      // from a click and bypass the isTrusted guard on click handlers.
      try {
        btn.focus();
        const keyOpts = { bubbles: true, cancelable: true, composed: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 };
        btn.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
        btn.dispatchEvent(new KeyboardEvent("keypress", keyOpts));
        btn.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
      } catch (_) {}
      r = await waitFor(Math.min(timeoutMs, 3000));
      if (r !== "timeout") {
        document.documentElement.setAttribute("data-autoapply-submit", r + ":fallback-key");
        return r;
      }
      // Strategy 5: focus the password field and press Enter to trigger
      // implicit form submission via the browser's native submit pipeline.
      try {
        const pw = document.querySelector('[data-automation-id="verifyPassword"]') ||
                   document.querySelector('[data-automation-id="password"]');
        if (pw) {
          pw.focus();
          const keyOpts = { bubbles: true, cancelable: true, composed: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 };
          pw.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
          pw.dispatchEvent(new KeyboardEvent("keypress", keyOpts));
          pw.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
        }
      } catch (_) {}
      r = await waitFor(timeoutMs);
      document.documentElement.setAttribute("data-autoapply-submit", r + ":fallback-pwenter");
      return r;
    }

    /** Faithful click: pointer + mouse + click, all bubbles+composed. */
    async _realClick(el) {
      if (!el) return false;
      // Workday wraps its real submit/submit-like buttons with an invisible
      // sibling `<div data-automation-id="click_filter">` that captures real
      // clicks and forwards them. Synthetic events on the button itself are
      // ignored. Re-target to the click_filter when present.
      const filtered = this._resolveClickFilter(el);
      if (filtered) el = filtered;
      el.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 50));
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const common = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window };
      try {
        el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerType: "mouse", isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mousedown", common));
        el.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0, pointerType: "mouse", isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { ...common, buttons: 0 }));
        el.dispatchEvent(new MouseEvent("click", { ...common, buttons: 0 }));
      } catch (_) {
        try { el.click(); } catch (_) {}
      }
      return true;
    }

    /**
     * If `el` is a Workday <button> that has a sibling click_filter overlay
     * (Workday's own anti-bot/intercept layer), return the click_filter so
     * the click actually registers. Otherwise return null.
     */
    _resolveClickFilter(el) {
      if (!el || el.getAttribute?.("data-automation-id") === "click_filter") return null;
      // Workday pairs a real BUTTON (aria-hidden, tabindex=-2) with a
      // sibling DIV[data-automation-id=click_filter] that owns the actual
      // pointer/click handler. Only redirect when our element is one of
      // those hidden buttons AND the filter is its direct sibling.
      if (el.tagName !== "BUTTON") return null;
      if (el.getAttribute?.("aria-hidden") !== "true") return null;
      const parent = el.parentElement;
      if (!parent) return null;
      const filter = parent.querySelector(':scope > [data-automation-id="click_filter"]');
      return filter || null;
    }

    /**
     * Resolve a Workday popup-button dropdown by clicking it, waiting for the
     * options popup, and clicking the matching option.
     */
    async _selectWorkdayDropdown(autoId, targetText) {
      if (!targetText) return false;
      const wrapper = document.querySelector(`[data-automation-id="${autoId}"]`);
      if (!wrapper) return false;
      const cur = (wrapper.innerText || "").toLowerCase();
      if (cur && cur.includes(targetText.toLowerCase()) && !/select one/i.test(cur)) return true;
      const trigger = wrapper.querySelector("button, [aria-haspopup]") || wrapper;
      await this._realClick(trigger);
      const popupSelector = '[data-automation-widget="wd-popup"] [role="option"], [role="listbox"] [role="option"], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"]';
      const start = Date.now();
      let options = [];
      while (Date.now() - start < 2500) {
        await new Promise((r) => setTimeout(r, 100));
        options = Array.from(document.querySelectorAll(popupSelector)).filter((o) => o.offsetParent !== null);
        if (options.length) break;
      }
      if (!options.length) return false;
      const t = targetText.toLowerCase();
      let match = options.find((o) => (o.innerText || "").trim().toLowerCase() === t);
      if (!match) match = options.find((o) => (o.innerText || "").toLowerCase().includes(t));
      if (!match) {
        await this._realClick(trigger);
        return false;
      }
      await this._realClick(match);
      await new Promise((r) => setTimeout(r, 250));
      return true;
    }

    async _fillWorkdayDropdowns() {
      const p = this.profile || {};
      const addr = p.address || {};
      await this._selectWorkdayDropdown("formField-country", addr.country);
      await this._selectWorkdayDropdown("formField-countryRegion", addr.state);
      await this._selectWorkdayDropdown("formField-phoneType", p.phoneType);
    }
  }

  ns.WorkdaySite = WorkdaySite;
})(typeof window !== "undefined" ? window : globalThis);

