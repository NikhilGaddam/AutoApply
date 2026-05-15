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
      byAuto("addressSection_county", "address.county");
      byAuto("addressSection_countryRegion", "address.state");
      byAuto("addressSection_postalCode", "address.postalCode");
      byAuto("address--addressLine1", "address.line1");
      byAuto("address--addressLine2", "address.line2");
      byAuto("address--city", "address.city");
      byAuto("address--county", "address.county");
      byAuto("address--regionSubdivision1", "address.county");
      byAuto("address--postalCode", "address.postalCode");
      byAuto("county", "address.county");
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
      // ----- My Experience (step 3) -----
      byAuto("jobTitle", "experience.0.title");
      byAuto("companyName", "experience.0.company");
      byAuto("company", "experience.0.company");
      byAuto("workExperienceLocation", "experience.0.location");
      byAuto("location", "experience.0.location");
      byAuto("roleDescription", "experience.0.description");
      byAuto("description", "experience.0.description");
      byAuto("schoolName", "education.0.school");
      byAuto("school", "education.0.school");
      byAuto("degree", "education.0.degree");
      byAuto("fieldOfStudy", "education.0.fieldOfStudy");
      byAuto("discipline", "education.0.fieldOfStudy");
      byAuto("gpa", "education.0.gpa");
      byAuto("url", "links.linkedin");
      byAuto("socialNetworkAccounts--linkedInAccount", "links.linkedin");
      byAuto("linkedInAccount", "links.linkedin");
      byAuto("socialNetworkAccounts--twitterAccount", "links.twitter");
      byAuto("twitterAccount", "links.twitter");
      byAuto("socialNetworkAccounts--facebookAccount", "links.facebook");
      byAuto("facebookAccount", "links.facebook");
      return map;
    }

    findFields() {
      return super.findFields().filter(el => {
        const text = `${el.id || ""} ${el.name || ""} ${el.getAttribute?.("data-automation-id") || ""}`;
        return !/^(workExperience|education)-\d+--/i.test(text);
      });
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
        console.log("AutoApply: clicking applyManually tile");
        await this._realClick(landing);
        await new Promise((r) => setTimeout(r, 2500)); // wait for auth page to render
        return; // let next tick handle the auth page
      }
      // 2. Sign-in tile selector (Apple / Google / LinkedIn / Email).
      const signInTile = document.querySelector('[data-automation-id="SignInWithEmailButton"]')
        || Array.from(document.querySelectorAll("button, a"))
            .find((b) => /sign in with email/i.test((b.innerText || "").trim()));
      const onAuthForm = !!(document.querySelector('[data-automation-id="signInSubmitButton"]') ||
                            document.querySelector('[data-automation-id="createAccountSubmitButton"]'));
      if (signInTile && !onAuthForm && !document.querySelector('[data-automation-id="email"]')) {
        console.log("AutoApply: clicking Sign In With Email tile");
        await this._realClick(signInTile);
        await new Promise((r) => setTimeout(r, 2500)); // wait for email/password form to expand
        return; // let next tick fill the form
      }

      // 3. Fill all currently-visible fields via the standard pipeline.
      const result = await super.fill();

      // Undo stale/broad social autofill on Workday. The Social Network URLs
      // wrapper contains LinkedIn/Twitter/Facebook text together, so older
      // matching could copy LinkedIn into empty Twitter/Facebook fields.
      this._clearEmptySocialLinks(result);

      // 3b. Password inputs in Workday are React-controlled with an
      // own-property tracker that isn't callable from an isolated content
      // script. Re-fill them via the background's chrome.scripting
      // (world: "MAIN") so direct assignment goes through React's tracker.
      await this._fillPasswordsMainWorld();

      // 3c. Workday's Country / State / Phone Type are custom button-widgets.
      await this._fillWorkdayDropdowns(result);
      await this._fillMyInformationDirect(result);
      this._fillPreviousWorkerRadio(result);

      // 3d. Workday's "My Experience" page is made of repeatable React
      // sections whose field labels/automation ids vary by tenant. Scan the
      // live DOM and fill visible/open work, education, and link blocks.
      await this._fillMyExperience(result);

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

      // Sign-in form: submit, then wait up to 12s watching for Workday's
      // error message OR the application form. Do NOT count URL change alone
      // as success — Workday redirects to /login even on wrong credentials.
      if (signInBtn && !SS.get("signInFailed") && emailEl?.value && pwEl?.value) {
        // Let React finish processing the filled values before submitting.
        await new Promise((r) => setTimeout(r, 2000));
        try { document.activeElement?.blur?.(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 1000));
        document.documentElement.setAttribute("data-autoapply-auth", "submit:signin");
        console.log("AutoApply: submitting sign-in for", emailEl.value);
        await this._realClick(signInBtn);

        // Poll (up to 12s) for either: app form (real success) or error msg (failure).
        // Keeps polling even after URL change so we catch the error on /login page.
        let signInResult = "timeout";
        const pollStart = Date.now();
        while (Date.now() - pollStart < 12000) {
          await new Promise((r) => setTimeout(r, 600));
          if (document.querySelector('[data-automation-id="pageFooterNextButton"], [data-automation-id="legalNameSection_firstName"]')) {
            signInResult = "success";
            break;
          }
          const errEl = document.querySelector('[data-automation-id="errorMessage"]');
          if (errEl) {
            const txt = (errEl.innerText || "").trim();
            if (txt) { signInResult = "error"; console.warn("AutoApply: sign-in error:", txt); break; }
          }
        }

        document.documentElement.setAttribute("data-autoapply-auth", "result:" + signInResult);
        if (signInResult !== "success") {
          console.log("AutoApply: sign-in failed, switching to Create Account in 3s...");
          SS.set("signInFailed", "1");
          await new Promise((res) => setTimeout(res, 3000));
          const cl2 = document.querySelector('[data-automation-id="createAccountLink"]');
          if (cl2) {
            console.log("AutoApply: clicking createAccountLink");
            await this._realClick(cl2);
            await new Promise((res) => setTimeout(res, 3000)); // wait for create form to expand
          }
        }
        return;
      }

      // If sign-in is known to fail AND account not yet created, switch to create form.
      // Guard: don't click createLink if createDone is already set — that would
      // re-open the create form when Workday is actually showing the email-verify
      // confirmation page (which also has signInBtn + createLink but no email input).
      if (signInBtn && SS.get("signInFailed") && createLink && !SS.get("createDone")) {
        console.log("AutoApply: sign-in known failed, clicking createAccountLink");
        await this._realClick(createLink);
        await new Promise((r) => setTimeout(r, 3000)); // wait for create form
        return;
      }

      // Create Account form: wait for all fields to be filled, then submit.
      if (createBtn && !SS.get("createDone") &&
          emailEl?.value && pwEl?.value && verifyEl?.value &&
          (!consentBox || consentBox.checked)) {
        // Extra pause: let React finish processing the filled values.
        await new Promise((r) => setTimeout(r, 2000));
        try { document.activeElement?.blur?.(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 1000)); // blur settle
        SS.set("createDone", "1");
        console.log("AutoApply: submitting Create Account for", emailEl.value);
        document.documentElement.setAttribute("data-autoapply-auth", "submit:create");
        const r = await this._submitAndWait(createBtn, {
          successSel: '[data-automation-id="legalNameSection_firstName"], [data-automation-id="pageFooterNextButton"]',
          errorSel: '[data-automation-id="errorMessage"], [data-automation-id="password"][aria-invalid="true"], [data-automation-id="verifyPassword"][aria-invalid="true"]',
          timeoutMs: 15000
        });
        document.documentElement.setAttribute("data-autoapply-auth", "result:" + r);
        if (r === "success") {
          const usedEmail = emailEl?.value || "";
          SS.set("createEmail", usedEmail);
          document.documentElement.setAttribute("data-autoapply-create-email", usedEmail);
        }
        // On error OR timeout: keep createDone set so we don't retry creation.
        // The email-verify wall check below will fire on the next tick and pause.
        return;
      }

      // Email-verify wall: fired when createDone is set (create was submitted or
      // account already exists) AND sign-in is known to fail. At this point the
      // user MUST verify their email before Workday will allow sign-in.
      // Does NOT require createBtn visible — Workday's confirmation page has
      // signInBtn + createLink but no email input or create form.
      if (SS.get("createDone") && SS.get("signInFailed") && !SS.get("verifyNotified")) {
        SS.set("verifyNotified", "1");
        const usedEmail = SS.get("createEmail") || document.documentElement.getAttribute("data-autoapply-create-email") || "unknown";
        console.warn(`AutoApply: Workday requires email verification. Check Gmail for ${usedEmail} then click the link and click Resume in the extension popup.`);
        document.documentElement.setAttribute("data-autoapply-auth", "waiting:email-verify");
        window.__autoApplyWorkdayPaused = true; // stop the loop until user resumes
      }

      if (this._visibleNextButton() && !this._isAuthGate() && this._hasValidationErrors()) {
        document.documentElement.setAttribute("data-autoapply-auth", "waiting:review-errors");
        window.__autoApplyWorkdayDriver = false;
      }

      // On normal application form steps, fill once and then stand down.
      // Keeping the driver alive causes repeated focus/scrollIntoView calls
      // from React-controlled fields and dropdowns, which pulls the user back
      // while they are trying to review or scroll. Mutation/navigation or a
      // manual Re-scan will start a fresh driver on the next step.
      if (this._visibleNextButton() && !this._isAuthGate() && !this._hasValidationErrors() && !this._myExperiencePendingRepeatables()) {
        document.documentElement.setAttribute("data-autoapply-auth", "waiting:next");
        window.__autoApplyWorkdayDriver = false;
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
      const TICK_MS = 2000;
      let inflight = false;
      const tick = async () => {
        if (Date.now() - startedAt > BUDGET_MS) {
          window.__autoApplyWorkdayDriver = false;
          return;
        }
        if (!inflight && !window.__autoApplyWorkdayPaused) {
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
        if (!window.__autoApplyWorkdayDriver) return;
        setTimeout(tick, TICK_MS);
      };
      setTimeout(tick, TICK_MS);
    }

    _visibleNextButton() {
      const btn = document.querySelector('[data-automation-id="pageFooterNextButton"]') ||
        Array.from(document.querySelectorAll("button, [role='button']")).find(el => this._isVisible(el) && /^(next|save and continue|continue)$/i.test((el.innerText || el.textContent || "").trim()));
      return !!(btn && this._isVisible(btn) && !btn.disabled);
    }

    _isAuthGate() {
      return !!(
        document.querySelector('[data-automation-id="signInSubmitButton"]') ||
        document.querySelector('[data-automation-id="createAccountSubmitButton"]') ||
        document.querySelector('[data-automation-id="SignInWithEmailButton"]')
      );
    }

    _hasValidationErrors() {
      if (document.querySelector('[aria-invalid="true"], [data-automation-id="errorMessage"], [data-automation-id="errorHeading"]')) return true;
      return /\bErrors Found\b/.test(document.body?.innerText || "");
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
              // Return "error" if there's visible error text OR if any matching
              // element is an input (aria-invalid inputs have no innerText but
              // still signal a validation failure).
              if (txt || Array.from(errs).some(e => e.tagName === "INPUT")) return "error";
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
      const normalizedTarget = this._normalizeText(targetText);
      const cur = this._normalizeText(wrapper.innerText || "");
      if (cur && cur.includes(normalizedTarget) && !/select one/i.test(cur)) return true;
      const trigger = wrapper.querySelector("button, [aria-haspopup]") || wrapper;
      await this._realClick(trigger);
      const popupSelector = '[data-automation-widget="wd-popup"] [role="option"], [role="listbox"] [role="option"], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"]';
      const visibleOptions = () => Array.from(document.querySelectorAll(popupSelector)).filter((o) => this._isVisible(o));
      const chooseOption = (options) => {
        let match = options.find((o) => this._normalizeText(o.innerText || "") === normalizedTarget);
        if (!match) match = options.find((o) => {
          const text = this._normalizeText(o.innerText || "");
          return text && normalizedTarget.length >= 2 && (text.includes(normalizedTarget) || normalizedTarget.includes(text));
        });
        return match || null;
      };
      const waitForOptions = async (ms = 1800) => {
        const start = Date.now();
        let options = [];
        while (Date.now() - start < ms) {
          await new Promise((r) => setTimeout(r, 100));
          options = visibleOptions();
          if (options.length) break;
        }
        return options;
      };
      const searchQueries = () => {
        const queries = [];
        const add = (value) => {
          const raw = String(value || "").trim();
          const normalized = this._normalizeText(raw);
          for (const query of [raw, normalized]) if (query && !queries.includes(query)) queries.push(query);
        };
        add(targetText);
        const words = normalizedTarget.split(" ").filter(Boolean);
        words.forEach(add);
        for (let index = 1; index <= Math.min(normalizedTarget.length, 12); index += 1) add(normalizedTarget.slice(0, index));
        words.forEach(word => {
          for (let index = 1; index <= Math.min(word.length, 8); index += 1) add(word.slice(0, index));
        });
        return queries;
      };
      let options = await waitForOptions();
      let match = chooseOption(options);
      if (!match) {
        const popup = document.querySelector('[data-automation-widget="wd-popup"], [role="listbox"]') || document;
        const searchInput = Array.from(popup.querySelectorAll("input, [contenteditable='true']"))
          .find(el => this._isVisible(el));
        if (searchInput) {
          for (const query of searchQueries()) {
            ns.FormFiller.fillField(searchInput, query);
            await new Promise((r) => setTimeout(r, 350));
            options = visibleOptions();
            match = chooseOption(options);
            if (match) break;
          }
        }
      }
      if (!match) {
        await this._realClick(trigger);
        return false;
      }
      await this._realClick(match);
      await new Promise((r) => setTimeout(r, 250));
      return true;
    }

    // Fill Workday's React-controlled password inputs via chrome.scripting
    // (world: "MAIN") because their own-property React tracker is not
    // callable from an extension isolated world.
    async _fillPasswordsMainWorld() {
      const { fillInputMainWorld } = AutoApply.FormFiller;
      const p = this.profile || {};
      const acct = p.account || {};
      const createFormVisible = !!document.querySelector('[data-automation-id="verifyPassword"]');
      const pwValue = createFormVisible
        ? (acct.passwordCreate || acct.password || "")
        : (acct.password || "");

      // Fill verifyPassword FIRST so when password is filled and React runs
      // cross-field validation, both fields already match (no clear).
      const fills = [
        ...(createFormVisible
          ? [{ sel: '[data-automation-id="verifyPassword"]', val: acct.passwordCreate || acct.password || "" }]
          : []),
        { sel: '[data-automation-id="password"]', val: pwValue }
      ];

      for (const { sel, val } of fills) {
        if (!val) continue;
        const el = document.querySelector(sel);
        if (!el) continue;
        if (el.value === val) continue; // already correct
        await fillInputMainWorld(el, val);
        // Short pause so React processes the change event before next fill.
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    async _fillWorkdayDropdowns(result) {
      const p = this.profile || {};
      const addr = p.address || {};
      await this._fillWorkdaySourceWithAi(result);
      await this._selectWorkdayDropdown("formField-country", addr.country);
      await this._selectWorkdayDropdown("formField-countryRegion", addr.state);
      await this._selectWorkdayDropdown("formField-phoneType", p.phoneType);
      await this._fillCountyField(result);
    }

    async _workdayDropdownOptions(autoId) {
      const wrapper = document.querySelector(`[data-automation-id="${autoId}"]`);
      if (!wrapper) return [];
      try { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", code: "Escape", keyCode: 27 })); } catch (_) {}
      const trigger = wrapper.querySelector('[data-automation-id="promptIcon"], input[id], button, [aria-haspopup]') || wrapper;
      await this._realClick(trigger);
      try { trigger.focus?.(); } catch (_) {}
      const input = wrapper.querySelector("input[id]");
      if (autoId === "formField-source" && input) {
        ns.FormFiller.fillField(input, "recruiter");
      }
      const popupSelector = '[data-automation-widget="wd-popup"] [role="option"], [role="listbox"] [role="option"], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"]';
      const start = Date.now();
      let options = [];
      while (Date.now() - start < 1800) {
        await new Promise(resolve => setTimeout(resolve, 100));
        options = Array.from(document.querySelectorAll(popupSelector))
          .filter(el => this._isVisible(el))
          .map(el => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        if (autoId === "formField-source") {
          options = options.filter(option => /recruiter|staffing|referral|worker|contractor|job site|social media|contacted/i.test(option));
        }
        if (options.length) break;
      }
      try { trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", code: "Escape", keyCode: 27 })); } catch (_) {}
      return Array.from(new Set(options));
    }

    async _selectWorkdayPrompt(autoId, targetText) {
      const wrapper = document.querySelector(`[data-automation-id="${autoId}"]`);
      if (!wrapper || !targetText) return false;
      const input = wrapper.querySelector('input[id]');
      const trigger = wrapper.querySelector('[data-automation-id="promptIcon"]') || input || wrapper;
      try { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", code: "Escape", keyCode: 27 })); } catch (_) {}
      await this._realClick(trigger);
      try { input?.focus?.(); } catch (_) {}
      const popupSelector = '[data-automation-widget="wd-popup"] [role="option"], [role="listbox"] [role="option"], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]';
      const normalizedTargets = this._optionTargetAlternates(targetText).map(value => this._normalizeText(value));
      const visibleOptions = () => Array.from(document.querySelectorAll(popupSelector)).filter(el => this._isVisible(el));
      const choose = () => visibleOptions().filter(option => {
        if (autoId !== "formField-source") return true;
        return /recruiter|staffing|referral|worker|contractor|job site|social media|contacted/i.test(option.innerText || option.textContent || "");
      }).find(option => {
        const text = this._normalizeText(option.innerText || option.textContent || "");
        return text && normalizedTargets.some(target => text === target || text.includes(target) || target.includes(text));
      });
      let match = null;
      const queries = this._optionTargetAlternates(targetText);
      for (const query of queries) {
        if (input) {
          ns.FormFiller.fillField(input, query);
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        match = choose();
        if (match) break;
      }
      if (!match) {
        await new Promise(resolve => setTimeout(resolve, 800));
        match = choose();
      }
      if (!match) return false;
      await this._realClick(match);
      await new Promise(resolve => setTimeout(resolve, 300));
      return /\b1 item selected\b|\bitems selected\b/i.test(wrapper.innerText || "") || this._normalizeText(wrapper.innerText || "").includes(this._normalizeText(targetText));
    }

    async _fillWorkdaySourceWithAi(result) {
      const wrapper = document.querySelector('[data-automation-id="formField-source"]');
      if (!wrapper) return false;
      const options = await this._workdayDropdownOptions("formField-source");
      if (!options.length) return false;
      let value = "";
      let aiError = "";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "claudeAgent.fillMissingFields",
          payload: {
            profile: this.profile || {},
            resumeText: this.profile?.resumeText || this.profile?.resumeSummary || "",
            page: { url: location.href, title: document.title, formText: (document.body?.innerText || "").slice(0, 3000) },
            fields: [{
              id: "workday-source",
              name: "source",
              label: "How did you hear about this job? Choose the best exact dropdown option. Prefer recruiter, talent acquisition, sourcer, reached out, or contacted options. Avoid LinkedIn, job board, and job site options when any recruiter-style option exists.",
              type: "dropdown",
              options,
              reason: "required"
            }]
          }
        });
        aiError = response?.ok === false ? (response.error || "AI source choice failed") : "";
        value = response?.actions?.find(action => action.type === "fill" || !action.type)?.value || "";
      } catch (e) {
        aiError = e?.message || "AI source choice unavailable";
      }
      if (!value) {
        value = this._fallbackSourceOption(options);
        if (value) ns.Overlay?.updateAi?.({ appendLog: `AI source choice unavailable${aiError ? `: ${aiError}` : ""}. Selected best visible source option: ${value}.` });
      }
      if (!value) return false;
      const ok = await this._selectWorkdayPrompt("formField-source", value) || await this._selectWorkdayDropdown("formField-source", value);
      if (ok) this._recordFill(result, wrapper, "applicationSource", value);
      return ok;
    }

    _fallbackSourceOption(options) {
      const unique = Array.from(new Set((options || []).map(option => String(option || "").trim()).filter(Boolean)));
      const recruiter = unique.find(option => /recruiter|talent acquisition|sourcer|contacted|reached out/i.test(option) && !/job site|job board|linkedin/i.test(option));
      if (recruiter) return recruiter;
      return unique.find(option => !/job site|job board|linkedin/i.test(option)) || "";
    }

    async _fillCountyField(result) {
      const county = this.profile?.address?.county;
      if (!county) return false;
      return this._fillFieldByPatterns(result, "address.county", county, [/^county$/, /\bcounty\b/], document, { includeFilled: true });
    }

    async _fillMyInformationDirect(result) {
      const addr = this.profile?.address || {};
      const fields = [
        ["name--legalName--firstName", "firstName", this.profile?.firstName],
        ["name--legalName--lastName", "lastName", this.profile?.lastName],
        ["address--addressLine1", "address.line1", addr.line1],
        ["address--addressLine2", "address.line2", addr.line2],
        ["address--city", "address.city", addr.city],
        ["address--postalCode", "address.postalCode", addr.postalCode],
        ["address--regionSubdivision1", "address.county", addr.county],
        ["address--county", "address.county", addr.county],
        ["phoneNumber--phoneNumber", "phoneLocal", this.profile?.phoneLocal]
      ];
      for (const [id, key, value] of fields) {
        await this._fillGeneratedInput(result, key, id, value);
      }
    }

    _fillPreviousWorkerRadio(result) {
      const value = String(this.profile?.previouslyEmployed || "No").toLowerCase().startsWith("y") ? "true" : "false";
      const el = document.querySelector(`input[type="radio"][name="candidateIsPreviousWorker"][value="${value}"]`);
      if (!el || el.checked) return !!el?.checked;
      el.click();
      if (!el.checked) {
        el.checked = true;
        el.setAttribute("aria-checked", "true");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (el.checked) this._recordFill(result, el, "previouslyEmployed", this.profile?.previouslyEmployed || "No");
      return el.checked;
    }

    _isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle?.(el);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
      return !!(el.offsetParent || el.getClientRects?.().length);
    }

    _normalizeText(value) {
      return String(value || "")
        .replace(/[’']/g, "")
        .replace(/[^a-z0-9]+/gi, " ")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
    }

    _hasValue(el) {
      if (!el) return false;
      const type = (el.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio") return !!el.checked;
      if (type === "file") return !!el.files?.length;
      return !!String(el.value || el.textContent || "").trim();
    }

    _fieldText(el) {
      const parts = [];
      const { FieldMatcher } = ns;
      try { parts.push(FieldMatcher.collectLabelText(el) || ""); } catch (_) {}
      parts.push(el?.getAttribute?.("aria-label") || "");
      parts.push(el?.getAttribute?.("data-automation-id") || "");
      parts.push(el?.name || "", el?.id || "", el?.placeholder || "");
      let node = el?.closest?.("[data-automation-id^='formField-'], [data-automation-id*='Experience'], [data-automation-id*='Education'], [role='group'], fieldset, section, div");
      let hops = 0;
      while (node && hops < 2) {
        parts.push(node.getAttribute?.("data-automation-id") || "");
        parts.push((node.innerText || node.textContent || "").slice(0, 300));
        node = node.parentElement;
        hops += 1;
      }
      return this._normalizeText(parts.join(" "));
    }

    _dateValue(date, mode = "full") {
      if (!date) return "";
      const match = String(date).match(/^(\d{4})(?:-(\d{1,2}))?/);
      if (!match) return String(date);
      const year = match[1];
      const month = match[2] ? match[2].padStart(2, "0") : "";
      if (mode === "year") return year;
      if (mode === "month") return month;
      if (mode === "monthYear") return month ? `${month}/${year}` : year;
      return month ? `${year}-${month}` : year;
    }

    _allFillables(scope = document) {
      return Array.from(scope.querySelectorAll("input, select, textarea, [contenteditable='true']"))
        .filter(el => ns.FormFiller.isFillable(el) && this._isVisible(el));
    }

    _entryPrefixes(kind) {
      const regex = kind === "education" ? /^(education-\d+)--/ : /^(workExperience-\d+)--/;
      const seen = new Set();
      const prefixes = [];
      document.querySelectorAll("input, textarea, select, button").forEach(el => {
        const match = String(el.id || "").match(regex);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          prefixes.push(match[1]);
        }
      });
      return prefixes;
    }

    async _fillGeneratedInput(result, key, id, value) {
      if (value == null || value === "") return false;
      const el = document.getElementById(id);
      if (!el || !this._isVisible(el)) return false;
      const ok = await ns.FormFiller.fillInputMainWorld(el, value) || ns.FormFiller.fillField(el, value);
      if (ok) this._recordFill(result, el, key, value);
      return ok;
    }

    async _fillGeneratedDate(result, keyPrefix, prefix, date, includeMonth = true) {
      if (!prefix || !date) return false;
      const month = this._dateValue(date, "month");
      const year = this._dateValue(date, "year");
      let ok = false;
      if (includeMonth && month) ok = await this._fillGeneratedInput(result, `${keyPrefix}.month`, `${prefix}-dateSectionMonth-input`, month) || ok;
      if (year) ok = await this._fillGeneratedInput(result, `${keyPrefix}.year`, `${prefix}-dateSectionYear-input`, year) || ok;
      return ok;
    }

    _checkGeneratedCheckbox(result, key, id, expectedChecked) {
      const el = document.getElementById(id);
      if (!el || !this._isVisible(el)) return false;
      if (!!el.checked !== !!expectedChecked) {
        el.click();
        if (!!el.checked !== !!expectedChecked) {
          el.checked = !!expectedChecked;
          el.setAttribute("aria-checked", String(!!expectedChecked));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      if (!!el.checked === !!expectedChecked) this._recordFill(result, el, key, expectedChecked);
      return !!el.checked === !!expectedChecked;
    }

    _findField(patterns, scope = document, { includeFilled = false } = {}) {
      const regexes = patterns.map(p => p instanceof RegExp ? p : new RegExp(p, "i"));
      return this._allFillables(scope).find(el => {
        if (!includeFilled && this._hasValue(el)) return false;
        if (arguments[2]?.idPattern) {
          const idText = `${el.id || ""} ${el.name || ""} ${el.getAttribute?.("data-automation-id") || ""}`;
          if (!arguments[2].idPattern.test(idText)) return false;
        }
        const text = this._fieldText(el);
        return regexes.some(re => re.test(text));
      }) || null;
    }

    _recordFill(result, el, key, value) {
      if (!result || !el) return;
      if (!result.filled.some(item => item.el === el)) result.filled.push({ el, key, value });
      result.unmapped = (result.unmapped || []).filter(item => item !== el);
      result.skipped = (result.skipped || []).filter(item => item.el !== el);
    }

    async _fillFieldByPatterns(result, key, value, patterns, scope = document, options = {}) {
      if (value == null || value === "") return false;
      const el = this._findField(patterns, scope, options);
      if (!el) return false;
      const type = (el.type || "").toLowerCase();
      const tag = (el.tagName || "").toLowerCase();
      let ok = false;
      if (type === "checkbox") {
        if (!el.checked) ok = this.checkCheckbox(el);
        else ok = true;
      } else if ((tag === "input" || tag === "textarea") && el.getAttribute?.("data-automation-id")) {
        ok = await ns.FormFiller.fillInputMainWorld(el, value);
        if (!ok) ok = ns.FormFiller.fillField(el, value);
      } else {
        ok = ns.FormFiller.fillField(el, value);
      }
      if (ok) this._recordFill(result, el, key, value);
      return ok;
    }

    async _clickAddButton(sectionWords) {
      const words = sectionWords.map(word => this._normalizeText(word));
      const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
        .filter(btn => this._isVisible(btn));
      const positioned = this._sectionAddButton(buttons, words);
      const btn = positioned || buttons.find(btn => {
        const ownText = this._normalizeText(`${btn.innerText || btn.textContent || ""} ${btn.getAttribute?.("aria-label") || ""} ${btn.getAttribute?.("data-automation-id") || ""}`);
        if (!/\b(add|new|add button)\b/.test(ownText)) return false;
        if (words.some(word => ownText.includes(word))) return true;
        let node = btn.parentElement;
        for (let hops = 0; node && hops < 5; hops += 1, node = node.parentElement) {
          const text = this._normalizeText(node.innerText || node.textContent || "");
          if (text.length > 180) continue;
          if (/\b(add|new)\b/.test(text) && words.some(word => text.includes(word))) return true;
        }
        return false;
      });
      if (!btn) return false;
      try { btn.click(); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 250));
      if (!this._workdaySectionOpened(sectionWords)) await this._realClick(btn);
      await new Promise(resolve => setTimeout(resolve, 900));
      return true;
    }

    _sectionAddButton(buttons, words) {
      const addButtons = buttons.filter(btn => /\b(add|new|add another|add button)\b/i.test(btn.innerText || btn.textContent || btn.getAttribute?.("aria-label") || btn.getAttribute?.("data-automation-id") || ""));
      if (!addButtons.length) return null;
      const sectionHints = Array.from(document.querySelectorAll("h1, h2, h3, h4, [role='heading'], legend, label, div, span"))
        .filter(el => this._isVisible(el))
        .map(el => ({ el, text: this._normalizeText(el.innerText || el.textContent || ""), y: el.getBoundingClientRect().top }))
        .filter(item => item.text && item.text.length <= 80);
      const topFor = patterns => {
        const match = sectionHints.find(item => patterns.some(pattern => pattern.test(item.text)));
        return match ? match.y : null;
      };
      let start = null;
      let end = null;
      if (words.some(word => /work|experience|employment/.test(word))) {
        start = topFor([/\bwork experience\b/, /\bemployment\b/]);
        end = topFor([/\beducation\b/, /\bschool\b/]);
      } else if (words.some(word => /education|school/.test(word))) {
        start = topFor([/\beducation\b/, /\bschool\b/]);
        end = topFor([/\bresume\b/, /\bwebsites?\b/, /\bsocial\b/]);
      }
      if (start == null) return null;
      return addButtons.find(btn => {
        const y = btn.getBoundingClientRect().top;
        return y > start && (end == null || y < end);
      }) || null;
    }

    _workdaySectionOpened(sectionWords) {
      const words = sectionWords.map(word => this._normalizeText(word)).join(" ");
      const fields = this._allFillables(document);
      if (/work|experience|employment/.test(words)) {
        return fields.some(el => /workExperience|jobTitle|companyName|roleDescription/.test(`${el.id || ""} ${el.name || ""} ${el.getAttribute?.("data-automation-id") || ""}`));
      }
      if (/education|school/.test(words)) {
        return fields.some(el => /education|school|degree|fieldOfStudy|gpa/.test(`${el.id || ""} ${el.name || ""} ${el.getAttribute?.("data-automation-id") || ""}`));
      }
      return false;
    }

    _myExperiencePendingRepeatables() {
      const text = this._normalizeText(document.body?.innerText || "");
      if (!/current step \d+ of \d+ my experience|my experience/.test(text)) return false;
      const needsWork = !this._workdaySectionOpened(["work experience"]);
      const needsEducation = !this._workdaySectionOpened(["education"]);
      if (!needsWork && !needsEducation) return false;
      return Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(btn => this._isVisible(btn))
        .some(btn => {
          const ownText = this._normalizeText(`${btn.innerText || btn.textContent || ""} ${btn.getAttribute?.("aria-label") || ""} ${btn.getAttribute?.("data-automation-id") || ""}`);
          if (!/\b(add|new|add button)\b/.test(ownText)) return false;
          let node = btn.parentElement;
          for (let hops = 0; node && hops < 5; hops += 1, node = node.parentElement) {
            const sectionText = this._normalizeText(node.innerText || node.textContent || "");
            if (sectionText.length > 180) continue;
            if (needsWork && /work experience|employment/.test(sectionText)) return true;
            if (needsEducation && /education|school/.test(sectionText)) return true;
          }
          return false;
        });
    }

    async _selectDropdownByPatterns(patterns, targetText, scope = document) {
      if (!targetText) return false;
      const regexes = patterns.map(p => p instanceof RegExp ? p : new RegExp(p, "i"));
      const wrappers = Array.from(scope.querySelectorAll("[data-automation-id^='formField-'], [data-automation-id*='Field'], [role='combobox'], [aria-haspopup='listbox']"))
        .filter(el => this._isVisible(el));
      const wrapper = wrappers.find(el => regexes.some(re => re.test(this._fieldText(el))));
      if (!wrapper) return false;
      const autoId = wrapper.getAttribute?.("data-automation-id");
      if (autoId) return this._selectWorkdayDropdown(autoId, targetText);
      const trigger = wrapper.querySelector?.("button, [aria-haspopup]") || wrapper;
      await this._realClick(trigger);
      return false;
    }

    _optionTargetAlternates(targetText) {
      const raw = String(targetText || "").trim();
      if (!raw) return [];
      const normalized = this._normalizeText(raw);
      const values = [raw];
      const add = value => {
        if (value && !values.some(existing => this._normalizeText(existing) === this._normalizeText(value))) values.push(value);
      };
      if (/computer (science|engineering)|software engineering|computer information/i.test(normalized)) {
        add("Computer and Information Science");
      }
      if (/master|m\.?s\.?|ms\b/i.test(normalized)) {
        add("Masters Degree");
        add("Master's Degree");
        add("Master of Science");
      }
      if (/bachelor|b\.?tech|btech/i.test(normalized)) {
        add("Bachelors Degree");
        add("Bachelor's Degree");
        add("Bachelor of Science");
      }
      return values;
    }

    async _selectWorkdayTrigger(trigger, targetText) {
      if (!trigger || !targetText) return false;
      const targets = this._optionTargetAlternates(targetText);
      const normalizedTargets = targets.map(value => this._normalizeText(value)).filter(Boolean);
      const currentText = this._normalizeText(trigger.innerText || trigger.textContent || trigger.getAttribute?.("aria-label") || "");
      if (currentText && normalizedTargets.some(target => currentText.includes(target)) && !/select one/i.test(currentText)) return true;
      await this._realClick(trigger);
      const popupSelector = '[data-automation-widget="wd-popup"] [role="option"], [role="listbox"] [role="option"], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"]';
      const visibleOptions = () => Array.from(document.querySelectorAll(popupSelector)).filter((o) => this._isVisible(o));
      const chooseOption = (options) => {
        let match = options.find((o) => normalizedTargets.includes(this._normalizeText(o.innerText || "")));
        if (!match) match = options.find((o) => {
          const text = this._normalizeText(o.innerText || "");
          return text && normalizedTargets.some(target => target.length >= 2 && (text.includes(target) || target.includes(text)));
        });
        return match || null;
      };
      const waitForOptions = async (ms = 1800) => {
        const start = Date.now();
        let options = [];
        while (Date.now() - start < ms) {
          await new Promise((r) => setTimeout(r, 100));
          options = visibleOptions();
          if (options.length) break;
        }
        return options;
      };
      const queries = [];
      const addQuery = (value) => {
        const raw = String(value || "").trim();
        const normalized = this._normalizeText(raw);
        for (const query of [raw, normalized]) if (query && !queries.includes(query)) queries.push(query);
      };
      targets.forEach(addQuery);
      const words = normalizedTargets.join(" ").split(" ").filter(Boolean);
      words.forEach(addQuery);
      normalizedTargets.forEach(target => {
        for (let index = 1; index <= Math.min(target.length, 12); index += 1) addQuery(target.slice(0, index));
      });
      words.forEach(word => {
        for (let index = 1; index <= Math.min(word.length, 8); index += 1) addQuery(word.slice(0, index));
      });

      let options = await waitForOptions();
      let match = chooseOption(options);
      if (!match) {
        const popup = document.querySelector('[data-automation-widget="wd-popup"], [role="listbox"]') || document;
        const searchInput = Array.from(popup.querySelectorAll("input, [contenteditable='true']"))
          .find(el => this._isVisible(el));
        if (searchInput) {
          for (const query of queries) {
            ns.FormFiller.fillField(searchInput, query);
            await new Promise((r) => setTimeout(r, 350));
            options = visibleOptions();
            match = chooseOption(options);
            if (match) break;
          }
        }
      }
      if (!match) {
        await this._realClick(trigger);
        return false;
      }
      await this._realClick(match);
      await new Promise((r) => setTimeout(r, 250));
      return true;
    }

    async _selectDropdownByIdPattern(idPattern, targetText) {
      if (!targetText) return false;
      const trigger = Array.from(document.querySelectorAll("button[aria-haspopup='listbox'], [role='combobox'], [aria-haspopup='listbox']"))
        .filter(el => this._isVisible(el))
        .find(el => idPattern.test(`${el.id || ""} ${el.name || ""} ${el.getAttribute?.("data-automation-id") || ""}`));
      if (!trigger) return false;
      return this._selectWorkdayTrigger(trigger, targetText);
    }

    async _fillExperienceEntry(result, exp, index = 0, prefix = null) {
      if (!exp) return;
      const title = exp.title || (index === 0 ? this.profile?.currentTitle : "");
      const company = exp.company || (index === 0 ? this.profile?.currentCompany : "");
      const idFor = suffix => prefix ? new RegExp(`^${prefix}--${suffix}`, "i") : new RegExp(`workExperience-\\d+--${suffix}`, "i");
      await this._fillFieldByPatterns(result, `experience.${index}.title`, title, [/job title|position title|role title|title\b/], document, { includeFilled: true, idPattern: idFor("jobTitle") });
      await this._fillFieldByPatterns(result, `experience.${index}.company`, company, [/company|employer|organization/], document, { includeFilled: true, idPattern: idFor("companyName") });
      await this._fillFieldByPatterns(result, `experience.${index}.location`, exp.location, [/location|city|work location/], document, { includeFilled: true, idPattern: idFor("location") });
      await this._fillFieldByPatterns(result, `experience.${index}.description`, exp.description, [/description|responsibilities|role description|summary|achievements/], document, { includeFilled: true, idPattern: idFor("roleDescription") });
      if (prefix) {
        this._checkGeneratedCheckbox(result, `experience.${index}.current`, `${prefix}--currentlyWorkHere`, !!exp.current);
        await this._fillGeneratedDate(result, `experience.${index}.startDate`, `${prefix}--startDate`, exp.startDate, true);
        if (!exp.current) await this._fillGeneratedDate(result, `experience.${index}.endDate`, `${prefix}--endDate`, exp.endDate, true);
      } else {
        await this._fillFieldByPatterns(result, `experience.${index}.current`, exp.current ? "Yes" : "No", [/currently work|i currently|current role|present/], document, { includeFilled: true, idPattern: idFor("currentlyWorkHere") });
      }
      await this._selectDropdownByPatterns([/start month|from month/], this._dateValue(exp.startDate, "month"));
      await this._selectDropdownByPatterns([/start year|from year/], this._dateValue(exp.startDate, "year"));
      if (!exp.current) {
        await this._selectDropdownByPatterns([/end month|to month/], this._dateValue(exp.endDate, "month"));
        await this._selectDropdownByPatterns([/end year|to year/], this._dateValue(exp.endDate, "year"));
      }
    }

    async _ensureWorkEntries(count) {
      let prefixes = this._entryPrefixes("workExperience");
      while (prefixes.length < count) {
        const before = prefixes.length;
        if (!(await this._clickAddButton(["work experience", "experience", "employment"]))) break;
        prefixes = this._entryPrefixes("workExperience");
        if (prefixes.length <= before) break;
      }
      return prefixes;
    }

    async _fillEducationEntry(result, edu, index = 0, prefix = null) {
      if (!edu) return;
      const base = prefix ? new RegExp(`^${prefix}--`) : /education-\d+--/i;
      const idFor = suffix => prefix ? new RegExp(`^${prefix}--${suffix}`, "i") : new RegExp(`education-\\d+--${suffix}`, "i");
      await this._fillFieldByPatterns(result, `education.${index}.school`, edu.school, [/school|university|college|institution/], document, { includeFilled: true, idPattern: idFor("school") });
      await this._fillFieldByPatterns(result, `education.${index}.fieldOfStudy`, edu.fieldOfStudy, [/field of study|major|discipline|area of study/], document, { includeFilled: true, idPattern: idFor("fieldOfStudy") });
      await this._fillFieldByPatterns(result, `education.${index}.gpa`, edu.gpa, [/gpa|grade point|overall result/], document, { includeFilled: true, idPattern: idFor("gradeAverage") });
      if (prefix) {
        await this._fillGeneratedDate(result, `education.${index}.startDate`, `${prefix}--firstYearAttended`, edu.startDate, false);
        await this._fillGeneratedDate(result, `education.${index}.endDate`, `${prefix}--lastYearAttended`, edu.endDate, false);
      } else {
        await this._fillFieldByPatterns(result, `education.${index}.startDate`, this._dateValue(edu.startDate, "year"), [/start date|first year|from date|attended from/], document, { includeFilled: true, idPattern: idFor("firstYearAttended") });
        await this._fillFieldByPatterns(result, `education.${index}.endDate`, this._dateValue(edu.endDate, "year"), [/end date|last year|graduation|attended to/], document, { includeFilled: true, idPattern: idFor("lastYearAttended") });
      }
      await this._selectDropdownByIdPattern(idFor("degree"), edu.degree);
      await this._selectDropdownByIdPattern(idFor("fieldOfStudy"), edu.fieldOfStudy);
      await this._selectDropdownByIdPattern(idFor("firstYearAttended"), this._dateValue(edu.startDate, "year"));
      await this._selectDropdownByIdPattern(idFor("lastYearAttended"), this._dateValue(edu.endDate, "year"));
      return base;
    }

    async _ensureEducationEntries(count) {
      let prefixes = this._entryPrefixes("education");
      while (prefixes.length < count) {
        const before = prefixes.length;
        if (!(await this._clickAddButton(["education", "school"]))) break;
        prefixes = this._entryPrefixes("education");
        if (prefixes.length <= before) break;
      }
      return prefixes;
    }

    async _fillLinks(result) {
      const links = this.profile?.links || {};
      if (links.linkedin) {
        await this._fillFieldByPatterns(result, "links.linkedin", links.linkedin, [/linkedin|linked in/]);
      }
      if (links.github) {
        await this._fillFieldByPatterns(result, "links.github", links.github, [/github|git hub/]);
      }
      if (links.portfolio) {
        await this._fillFieldByPatterns(result, "links.portfolio", links.portfolio, [/portfolio/]);
      }
      if (links.website) {
        await this._fillFieldByPatterns(result, "links.website", links.website, [/website|web address|personal url/]);
      }
      await this._selectDropdownByPatterns([/type|website type|url type|link type/], this.profile?.defaultProfileLinkType || "LinkedIn");
    }

    _clearInput(el) {
      if (!el || !el.value) return false;
      try { el.focus(); } catch (_) {}
      ns.FormFiller.setNativeValue(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      try { el.blur(); } catch (_) {}
      return !el.value;
    }

    _clearEmptySocialLinks(result) {
      const links = this.profile?.links || {};
      const knownLinks = [links.linkedin, links.github, links.portfolio, links.website]
        .filter(Boolean)
        .map(value => this._normalizeText(value));
      const socialFields = [
        { key: "links.twitter", value: links.twitter, selectors: ['#socialNetworkAccounts--twitterAccount', '[name="twitterAccount"]'] },
        { key: "links.facebook", value: links.facebook, selectors: ['#socialNetworkAccounts--facebookAccount', '[name="facebookAccount"]'] }
      ];
      for (const field of socialFields) {
        const el = field.selectors.map(sel => document.querySelector(sel)).find(Boolean);
        if (!el || !el.value) continue;
        const current = this._normalizeText(el.value);
        const profileValue = this._normalizeText(field.value || "");
        if (profileValue && profileValue === current && !knownLinks.includes(current)) continue;
        if (!knownLinks.includes(current)) continue;
        if (this._clearInput(el)) {
          result.unmapped = (result.unmapped || []).filter(item => item !== el);
          result.skipped = (result.skipped || []).filter(item => item.el !== el);
          result.skipped.push({ el, reason: `no-value:${field.key}` });
        }
      }
    }

    async _fillMyExperience(result) {
      const pageText = this._normalizeText(document.body?.innerText || "");
      const onMyExperience = /my experience|work experience|education|resume|websites|linkedin|skills/.test(pageText);
      if (!onMyExperience) return;

      const experiences = Array.isArray(this.profile?.experience) ? this.profile.experience.filter(Boolean) : [];
      const education = Array.isArray(this.profile?.education) ? this.profile.education.filter(Boolean) : [];
      const workPrefixes = experiences.length ? await this._ensureWorkEntries(experiences.length) : [];
      for (let index = 0; index < experiences.length; index += 1) {
        await this._fillExperienceEntry(result, experiences[index], index, workPrefixes[index] || null);
      }

      const prefixes = education.length ? await this._ensureEducationEntries(education.length) : [];
      for (let index = 0; index < education.length; index += 1) {
        await this._fillEducationEntry(result, education[index], index, prefixes[index] || null);
      }

      const hasLinkFields = this._findField([/linkedin|website|url|web address|profile link/], document, { includeFilled: true });
      if (!hasLinkFields) await this._clickAddButton(["website", "link", "url", "social"]);
      await this._fillLinks(result);
    }
  }

  ns.WorkdaySite = WorkdaySite;
})(typeof window !== "undefined" ? window : globalThis);

