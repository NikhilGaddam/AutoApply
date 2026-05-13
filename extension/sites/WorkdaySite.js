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
      byAuto("verifyPassword", "account.password");
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
      // 1. Landing page: click "Apply Manually" if visible.
      const landing = document.querySelector('[data-automation-id="applyManually"]');
      if (landing && !document.querySelector('[data-automation-id="signInSubmitButton"]') &&
          !document.querySelector('[data-automation-id="createAccountSubmitButton"]') &&
          !document.querySelector('[data-automation-id="legalNameSection_firstName"]')) {
        await this._realClick(landing);
        await new Promise((r) => setTimeout(r, 2500));
      }
      // 2. Sign-in selector tile (Google / LinkedIn / Email): pick Email.
      const signInWithEmail = Array.from(document.querySelectorAll("button, a"))
        .find((b) => /sign in with email/i.test((b.innerText || "").trim()));
      if (signInWithEmail && !document.querySelector('[data-automation-id="email"]')) {
        await this._realClick(signInWithEmail);
        await new Promise((r) => setTimeout(r, 1500));
      }

      // 3. Fill all currently-visible fields via the standard pipeline.
      const result = await super.fill();

      // 3b. Workday's Country / State / Phone Type are custom button-widgets,
      //     not native <select>. Drive them manually.
      await this._fillWorkdayDropdowns();

      // 4. If we're on the auth gate (sign-in or create-account form) and
      //    haven't tried yet this fill() call, drive it.
      if (!this._authAttempted) {
        const signInBtn = document.querySelector('[data-automation-id="signInSubmitButton"]');
        const createBtn = document.querySelector('[data-automation-id="createAccountSubmitButton"]');
        const emailInput = document.querySelector('[data-automation-id="email"]');
        if (emailInput && emailInput.value && (signInBtn || createBtn)) {
          this._authAttempted = true;
          await this._attemptAuth();
        }
      }

      return result;
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
      await this._realClick(btn);
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 250));
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
    }

    /** Faithful click: pointer + mouse + click, all bubbles+composed. */
    async _realClick(el) {
      if (!el) return false;
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

