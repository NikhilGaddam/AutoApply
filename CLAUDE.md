# CLAUDE.md

Project notes for future Claude/Copilot sessions working on AutoApply.

## What this is

A Chrome/Brave MV3 extension that detects job application pages and auto-fills
them from a profile derived from the user's resume. On unknown fields it
highlights them and shows a review toast before the user submits.

Target browser: **Brave** (Chromium-based) : Chrome blocks scripts from setting
`<input type="file">`, but Brave honours the `DataTransfer` workaround used by
`utils/resumeUploader.js`.

## Repo layout

```
extension/
  manifest.json              MV3, content_scripts at document_idle,
                             web_accessible_resources for assets/*
  background.js              Opens options page on first install
  content.js                 Entry point. Loads profile (deepMerge of
                             DEFAULT_PROFILE under chrome.storage.sync),
                             picks a Site handler, runs fill, mounts overlay,
                             watches for lazy-loaded question wrappers via
                             MutationObserver (debounced 400ms, 30s budget).
  data/defaultProfile.js     window.AutoApply.DEFAULT_PROFILE (Nikhil's data)
  utils/fieldMatcher.js      Ordered RULES regex array, label collection
                             with descendant-stripping cleanText helper.
  utils/formFiller.js        setNativeValue (React-safe), fillSelect,
                             fillCheckboxGroup (exact-then-substring,
                             length>=4 guard), fillField dispatcher.
  utils/resumeUploader.js    classifyFileInput, fetchAsFile, attachFile via
                             DataTransfer, uploadResume.
  sites/
    BaseSite.js              async fill() : iterates fields, resolves via
                             overrides.get(el) || matchField, calls fillField.
    LeverSite.js             hostMatches /jobs\.lever\.co$/, iterates ALL
                             <form> elements (Lever splits demographics into
                             a separate <form class="application-form hidden">).
                             customMappings by name: name→fullName, location→
                             currentLocation, org→currentCompany, urls[…]→links.*
    GreenhouseSite.js
    WorkdaySite.js
    GenericSite.js
    SiteRegistry.js          First matching hostMatches wins; GenericSite fallback.
  ui/overlay.{js,css}        Orange highlight unmapped, green filled,
                             review toast with click-to-focus.
  popup/popup.{html,css,js}  Auto-fill / Clear / Edit profile.
  options/options.{html,css,js}  JSON textarea editor.
  assets/resume.pdf          Packaged resume; fetched via
                             chrome-extension://...assets/resume.pdf
resumes/                     Source PDFs (gitignored except packaged copy).
scripts/launch-brave.sh      Kills existing CDP-Brave on 9222, launches with
                             --remote-debugging-port=9222
                             --remote-allow-origins=*
                             --user-data-dir=/tmp/brave-debug-profile
                             --load-extension=<repo>/extension
                             --disable-extensions-except=<repo>/extension
                             Waits for /json/version. Optional URL arg
                             (default: Spotify Senior Backend Engineer Lever page).
```

## Profile shape (DEFAULT_PROFILE)

Top-level keys actually wired into matcher rules:

- `firstName`, `lastName`, `fullName`
- `email`, `phone`
- `address` { street, city, state, zip, country: "United States" }
- `currentLocation` (free-text "Tysons Corner, Virginia, USA")
- `currentCompany` ("Strategy (formerly MicroStrategy)")
- `links` { linkedin, github, portfolio, website } : portfolio/website empty by default
- `workAuthorization` { …, requiresSponsorship: "No" }
- `demographics` { gender: "Man", race: "Asian",
  ethnicity: "Not Hispanic or Latino", veteranStatus: "I am not a veteran",
  disabilityStatus }
- `previouslyEmployed: "No"`, `over18: "Yes"`, `referredByEmployee: "No"`
- `pronouns: "He/him"`
- `resumeAsset`, `resumeFileName`, `resumeMimeType`
- `education`, `experience`, `skills` (currently informational)

## Field matching (utils/fieldMatcher.js)

`RULES` is **ordered** : first regex match wins. Labels are normalized to
lowercase. The label string is built from, in order:

1. `<label for="id">` (descendant inputs/selects/options/lists stripped)
2. Ancestor `<label>` (same stripping)
3. `aria-label` / `aria-labelledby` (stripped)
4. `placeholder`, `name`, `id`
5. Question-wrapper text via `QUESTION_SEL = "li.application-question,
   .application-question, fieldset, .form-group, .field"` looking up
   `:scope > .application-label`, `:scope > label`, `:scope > legend`, etc.

**Critical:** the `cleanText` helper clones the labelling node and removes
`input, select, textarea, option, ul, ol` descendants before reading
`innerText`. Without this, a `<label>` wrapping a country `<select>` leaks
all 250 country option names (e.g. "Mexico City"), causing the
`/\bcity\b/` rule to match before the country rule.

## Storage

`chrome.storage.sync` key `"autoapply.profile"`. `loadProfile()` does
`deepMerge(DEFAULT_PROFILE, stored)` : defaults sit under stored so newly
added keys (e.g. `demographics`) appear automatically even when a user has
an old saved profile. Without this, the matcher returns a key whose value
is `undefined` and 50 fields get skipped with `no-value` reasons.

## Testing workflow

```bash
pkill -9 -f "Brave Browser" 2>/dev/null; sleep 2
./scripts/launch-brave.sh    # optional: pass URL as $1
# CDP at http://127.0.0.1:9222/json : connect via websocket-client.
```

Inspect filled state via `Runtime.evaluate`. Useful audit expression in
session history: iterates `input[type=radio]` grouped by question-wrapper
label and reports first selected option, plus first `<select>` text.

## Bugs solved during build (don't re-break)

1. **Label leakage from wrapped form controls** : `<label>` wrappers expose
   their nested `<select>`'s option strings via `innerText`. Always use
   `cleanText` clone-and-strip before reading label text.
2. **Stale profile shape** : always deep-merge defaults under stored, never
   trust `chrome.storage.sync` to be current.
3. **Substring false positive on short option text** : "Man" target would
   match "Woman" radio. Two-pass: exact match first; substring only when
   target length ≥ 4.
4. **Per-option `<li>` breaking question lookup** : inside checkbox/radio
   groups, an option's own `<li>` is its closest `<li>`, not the question's
   `li.application-question`. Walk ancestors looking for QUESTION_SEL,
   don't `closest('li')`.
5. **Demographic survey in a separate `<form>`** : Lever uses
   `<form class="application-form hidden">` loaded lazily. Iterate ALL
   `<form>` elements in `findFields()`, not just `#application-form`.
6. **Lazy-loaded sections** : MutationObserver re-runs a `quietFill` pass
   when new QUESTION_SEL nodes appear (400ms debounce, 30s budget).
7. **CDP WebSocket 403** : Brave needs `--remote-allow-origins=*`.
8. **Manifest icons removal** left an unclosed brace : fixed.

## Current Spotify/Lever auto-fill coverage

Verified filled: resume, full name, email, phone, current location,
current company, LinkedIn, GitHub, pronouns (He/him), previously
employed → No, country dropdown → United States, gender → Man (both
variants of the question), race → Asian, veteran → No.

Intentionally left for user review: portfolio URL & other website
(empty in profile), 19-option UK-census ethnicity question (no default
mapping), marketing consent checkbox.

## Tesla (`tesla.com/careers/*`)

3-step React form: Personal Info → Legal/Disclosures → EEO. Uses dotted
`name` attrs (`personal.firstName`, `legal.legalNoticePeriod`,
`eeo.eeoGender`). Wrappers: `.tds-form-item`, `.tds-form-fieldset`,
`.tds-form-input-group`. Buttons go "Next" → "Next" → "Submit".

`extension/sites/TeslaSite.js` customMappings covers all 3 steps. Verified
9+9+6 fields filled. `eeoAcknowledgment`/`legalAcknowledgment` checkboxes
auto-tick via the consent autocheck path in `BaseSite.tryAcceptConsent`.

## Workday (`*.myworkdayjobs.com`, `*.workday.com`)

8-step flow gated by sign-in / create-account. Account creds live in
`profile.account.{email,password}` (DEFAULT_PROFILE seed —
should move to first-run wizard).

### Selectors are inconsistent across tenants

Inputs sometimes have `data-automation-id`, sometimes only `id`, sometimes
only `name`. CVS uses **id-only** for step 1 inputs (`name--legalName--firstName`,
`address--addressLine1`, `phoneNumber--phoneNumber`). The `byAuto()`
helper in `WorkdaySite.js` must check **all three**:

```js
document.querySelector(`[data-automation-id="${id}"]`) ||
document.getElementById(id) ||
document.querySelector(`[name="${id}"]`);
```

**Don't use `CSS.escape`** on the id — it mangles the `--` and selectors
miss. Use `getElementById` directly. Wrappers (state/country dropdowns,
form-field containers) DO use `data-automation-id` like
`formField-country`, `formField-countryRegion`, `formField-phoneType`.

### Workday button-style dropdowns (Country, State, Phone Type)

Not native `<select>`. They are `<button>` widgets that open a popup
listbox. `WorkdaySite._selectWorkdayDropdown(autoId, targetText)` handles
this: clicks the trigger → polls for `[data-automation-widget="wd-popup"]
[role="option"], [role="listbox"] [role="option"], [data-automation-id=
"promptOption"], [data-automation-id="promptLeafNode"]` (visible only) →
exact-match then substring-match → clicks the option via `_realClick`.

### Workday submit buttons need full pointer event sequence

Plain `el.click()` does NOT trigger Workday's React onClick on
`signInSubmitButton` / `createAccountSubmitButton` / `pageFooterNextButton`.
Must dispatch the full sequence (each event with `bubbles:true,
composed:true, cancelable:true, button:0, buttons:1, view:window,
clientX, clientY`):

1. `PointerEvent("pointerdown", {pointerType:"mouse", isPrimary:true})`
2. `MouseEvent("mousedown")`
3. `PointerEvent("pointerup", {buttons:0, pointerType:"mouse", isPrimary:true})`
4. `MouseEvent("mouseup", {buttons:0})`
5. `MouseEvent("click", {buttons:0})`

This is encapsulated in `WorkdaySite._realClick(el)`. Falls back to
`el.click()` on exception.

### Workday auth flow (`WorkdaySite._attemptAuth`)

1. Click `applyManually` if landing page.
2. Click "Sign in with email" tile if visible.
3. After main fill (`super.fill()`) populates `email`/`password`/`verifyPassword`/
   `createAccountCheckbox`, attempt **sign-in first** with
   `_submitAndWait(signInBtn, {successSel: legalNameSection_firstName |
   pageFooterNextButton, errorSel: errorMessage | role=alert, timeoutMs: 5000})`.
4. If sign-in fails (timeout or error), click `createAccountLink`, re-run
   `super.fill()` to populate `verifyPassword` and the privacy checkbox,
   then `_submitAndWait(createAccountSubmitButton, ..., 8000)`.

Verified end-to-end: Apply Manually → Sign in with email → fill creds →
Sign In attempt → fall through to Create Account → fill verify+privacy →
Create Account submit → lands on "current step 1 of 7 My Information".
**All driven from extension content script — no CDP needed.**

### Step 1 (My Information) selectors verified on CVS Workday

- `name--legalName--firstName` / `name--legalName--lastName` (id only)
- `address--addressLine1` / `address--addressLine2` / `address--city` /
  `address--postalCode` (id only)
- `phoneNumber--countryPhoneCode` / `phoneNumber--phoneNumber` /
  `phoneNumber--extension` (id only)
- `formField-country` / `formField-countryRegion` / `formField-phoneType`
  (button widgets, data-automation-id only)
- `phone-sms-opt-in` (checkbox; do NOT auto-tick — not in CONSENT_RE
  default — review)
- `beecatcher` is a **honeypot**; never fill.

### Workday phone field gotcha

`phone` profile key is "+1 571-635-2506" — that whole string would land
in `phoneNumber--phoneNumber` and trigger a "valid format" error.
Mapped instead:
- `phoneNumber--countryPhoneCode` → `profile.phoneCountryCode` ("+1")
- `phoneNumber--phoneNumber` → `profile.phoneLocal` ("571-635-2506")
- `phoneNumber--extension` → `profile.phoneExtension` ("")

### Stale chrome.storage profile

When iterating on `defaultProfile.js`, the stored profile in
`chrome.storage.sync` overrides defaults via `deepMerge`. To force fresh
defaults: **`rm -rf /tmp/brave-debug-profile`** before relaunching.
`chrome.storage.sync.remove()` evaluated via CDP `Runtime.evaluate` runs
in the **page world**, not the extension world — it silently no-ops.
Either delete the user-data-dir or use the popup's "Clear" button.

## Conventions

- New site handlers go in `extension/sites/`, extend `BaseSite`, register
  themselves by extending `SiteRegistry.handlers`. Order matters : first
  `hostMatches` wins.
- New matcher rules go in `RULES` in `utils/fieldMatcher.js`. **Order
  matters**: put more specific rules above more general ones. Tighten
  `\b…\b` boundaries to avoid catching option text from other dropdowns.
- New profile fields: add to `DEFAULT_PROFILE`, add a RULE, optionally add
  a `customMappings` entry in the relevant site handler if the field needs
  to be matched by `name` attribute instead of label text.
- Never trust `closest('li')` / `closest('label')` for question-level
  lookup inside radio/checkbox groups : walk to QUESTION_SEL.
- Always strip descendants from cloned label nodes before reading text.
