# AutoApply Chrome Extension

A Chrome extension that detects job application pages and auto-fills your details using a pure-algorithm (no AI) field matcher. Highlights any fields it can't map so you can review them before submitting.

## Features

- **Per-site handlers**: separate classes for Lever, Greenhouse, Workday, plus a generic fallback. Add more in `extension/sites/`.
- **Algorithmic field matching**: label / `name` / `placeholder` / `aria-*` text is normalized and matched against ordered regex rules in `utils/fieldMatcher.js`. First match wins.
- **Framework-friendly**: sets values via the React-compatible native setter and dispatches `input` + `change`.
- **Review overlay**: a floating toast shows counts of filled / needs-review / skipped fields, and lists the unmapped ones : click an item to scroll to and focus that field.
- **Profile editor**: open the Options page to edit the JSON profile. Defaults are seeded from `resumes/nikhil_gaddam.pdf`.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Toggle on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. On first install you'll be taken to the Options page to review your profile.

> **Icons**: The manifest references `icons/icon{16,48,128}.png`. Either drop your own PNGs in `extension/icons/` or remove the `icons` block + `default_icon` block from `manifest.json` while developing.

## Usage

- Navigate to an application page (e.g. `jobs.lever.co/.../apply`). The extension auto-runs when the URL or form text looks like an application.
- Click the extension icon and hit **Auto-fill this page** to trigger manually.
- Review the orange-highlighted fields, fix them, attach your resume manually (Chrome can't programmatically pick a local file), then submit.

## Architecture

```
extension/
├── manifest.json
├── background.js              # On install, opens options page
├── content.js                 # Entry: loads profile, picks handler, runs fill
├── data/
│   └── defaultProfile.js      # Defaults from resumes/nikhil_gaddam.pdf
├── utils/
│   ├── fieldMatcher.js        # Label text -> profile key (ordered regex rules)
│   └── formFiller.js          # Native-setter-aware input/select/checkbox filling
├── sites/
│   ├── BaseSite.js            # Common fill() workflow
│   ├── LeverSite.js           # jobs.lever.co
│   ├── GreenhouseSite.js      # boards.greenhouse.io
│   ├── WorkdaySite.js         # myworkdayjobs.com
│   ├── GenericSite.js         # Fallback
│   └── SiteRegistry.js        # Picks the most specific handler
├── ui/
│   ├── overlay.css
│   └── overlay.js             # Highlights + review toast
├── popup/                     # Toolbar popup
└── options/                   # Profile JSON editor
```

## Adding a new site

1. Create `sites/MySite.js` extending `BaseSite`:
   ```js
   class MySite extends ns.BaseSite {
     static id = "mysite";
     static label = "MySite";
     static hostMatches(url) { return /mysite\.com$/.test(url.hostname); }
     customMappings() {
       const map = new Map();
       const el = document.querySelector('[name="applicant_email"]');
       if (el) map.set(el, "email");
       return map;
     }
   }
   ns.MySite = MySite;
   ```
2. Register in `manifest.json` `content_scripts.js` (before `SiteRegistry.js`).
3. Add to `HANDLERS` array in `sites/SiteRegistry.js`.

## Limitations

- **Resume upload is manual.** Browsers block scripts from setting `<input type="file">` programmatically. The handler skips file inputs and leaves them for you.
- **Captchas / multi-step SPAs**: Workday in particular spreads fields across steps; mappings need to be re-run per step. The Re-scan button in the toast handles this.
- **No AI yet** : by design. Field matching is rule-based for predictability.
