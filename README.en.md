# 保填

English | [中文](README.md)

A Chrome / Edge form-filling assistant for graduate recommendation applications. It preserves the 1.0 full-page AI semantic-matching flow and adds deterministic value safeguards, filled-value auditing, multi-step background filling, repeatable tables, manual quick fill, and PDF document synthesis. Profile data stays in the browser; no account is required.

<div align="center">
  <a href="../../releases/latest"><b>⬇️ Download & Install</b></a>
</div>

<div align="center">
  <img src="assets/1-popup.png" width="210" alt="Popup" />
  <img src="assets/2-filling.png" width="210" alt="Filling" />
  <img src="assets/3-page.png" width="210" alt="Result" />
</div>

## Features

### Smart Form Filling
- Manages seven profile groups: basic info, family, education, languages, experience, academic work, and awards
- AI Enhanced Review (enabled by default) sends all safe fields on the current page to the configured API, as version 1.0 did, while deterministic stored values prevent factual rewrites
- AI Enhanced Review can be disabled to use the API only for fields that local rules cannot match
- Adds and fills repeatable rows for family members, language scores, experience, academic work, and awards; also handles record editors opened in a modal or drawer after an Add action
- Matches repeatable rows by group, row number, and subfield semantics, so different web-column ordering does not change the saved item mapping; optional AI fallback is grounded to the same stored row
- Fills modal/drawer record editors by subfield semantics rather than visual ordering, reads values back, and only clicks a record-level Save / Confirm / Add control inside that editor
- Aggregates one repeatable record into a single textarea when the page exposes only one field; ambiguous required fields, unreadable values, and protected controls pause for review instead of being guessed
- Supports exact-match school and major selection dialogs
- Works with React and other framework pages (uses native setters to trigger updates)
- Uses green, orange, and red readback states to show verified, review-needed, and mismatched values
- Draws the same green / orange / red state on page controls after preview; clicking a sidebar result locates and focuses the corresponding field
- Includes manual quick fill for complex controls not covered automatically

### Background Multi-step Filling
- Continues after the popup is closed and across both full navigations and single-page-app transitions
- Clicks only explicit safe next-step controls after the current page is filled and read back
- Pauses when required fields remain unresolved and stops after at most 20 pages
- Stops on the final review page and never clicks final submit, payment, CAPTCHA, agreements, advisor, or preference actions

### Local Backup and Restore
- Exports and imports all seven profile groups and repeatable items
- API keys and uploaded documents are excluded from profile backups

### Document Management
- Upload images (JPG/PNG/WebP) and PDF files
- Organize documents by category (ID, education, certificates, photos, etc.)
- Preview, rename, move between categories, and delete
- Recommends locally stored files for clearly identified upload fields using page context plus filenames, descriptions, and categories; document matches are unchecked until the user explicitly confirms them in preview

### PDF Synthesis
- Select images and PDFs from your documents, drag to reorder, then merge into one PDF
- Upload new files on the fly (auto-saved to your document library)
- Images auto-scale to fit A4 pages, centered with margins
- Merged result saved to your document library for easy download
- Runs entirely in the browser — no server needed

### API Configuration
- Supports both OpenAI-compatible Chat Completions (`/chat/completions`) and Responses (`/responses`)
- Connects to hosted providers, aggregators, third-party gateways, and local model servers
- Includes provider presets and supports custom Base URLs and model names
- Supports Fast mode (`service_tier: fast`), a privacy-safe API connection test, and an explicit per-scan indicator showing whether the API was actually called
- Optional Fast mode adds `service_tier: "fast"`; it is disabled by default

## Installation

### From Release (Recommended)

Download the zip file from [Releases](../../releases):

| File | Browser |
|------|---------|
| `baotian-chrome.zip` | Chrome / Edge / Brave and other Chromium-based browsers |
| `baotian-firefox.zip` | Firefox |

**Chrome / Edge:**

1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode** in the top-right corner
3. Extract the zip, click **Load unpacked**, and select the extracted directory

**Firefox:**

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the downloaded zip file (Firefox marks it as temporary — reload after restart)

### Build from Source

```bash
npm install
npm run build            # Chrome
npm run build:firefox    # Firefox
```

The output is in the `.output/` directory. Load it via "Load unpacked" in your browser's extension management page.

### Package

```bash
npm run zip            # Chrome
npm run zip:firefox    # Firefox
```

Output in `.output/`, ready for Chrome Web Store or GitHub Releases.

## Usage

1. Add and maintain the seven profile groups in the workbench.
2. Export a local backup after entering the profile and before reinstalling or changing devices.
3. On an application page, open the extension, scan and preview, then confirm the fill.
4. Choose background multi-step filling to continue until final review; handle any required-field pause before resuming.
5. Review every date, rank, selection, and repeatable row yourself before submission.
6. Optionally configure an API URL, protocol, key, and model for unresolved fields. Choose `Responses` for Codex-style models or gateways that only support that API.

> AI import from Word or PDF profile documents is not included in this version. Document management and PDF synthesis remain available.

## Safety and Privacy

- Profile data, documents, and API settings are stored in the current browser; the extension has no application server.
- Text is sent to the user-configured model provider only when an AI feature is actively used.
- The extension never automatically submits, pays, solves CAPTCHAs, accepts agreements, chooses advisors/preferences, or uploads files.
- Application systems differ; the applicant must review all filled values before submission.

## Tech Stack

- **Framework**: [WXT](https://wxt.dev/) (Vite-based browser extension framework)
- **Language**: TypeScript
- **UI**: Vanilla HTML/CSS, no framework
- **PDF**: [pdf-lib](https://pdf-lib.js.org/)
- **Pinyin**: [pinyin-pro](https://github.com/nicoleee-h/pinyin-pro)
- **Storage**: IndexedDB + chrome.storage.local

## Project Structure

```
├── entrypoints/
│   ├── background.ts        # Service Worker: message routing, LLM calls
│   ├── content.ts           # Content script: DOM scanning, form filling
│   ├── popup/               # Popup: scan → confirm → fill
│   └── options/             # Options page: info management, documents, PDF, settings
├── utils/
│   ├── db.ts                # IndexedDB wrapper
│   ├── storage.ts           # chrome.storage wrapper
│   ├── matcher.ts           # LLM semantic matching
│   ├── local-matcher.ts     # Deterministic local field matching
│   ├── profile-schema.ts    # Seven profile groups and language inference
│   ├── pdf-merge.ts         # PDF merge logic
│   └── providers.ts         # API provider presets
└── public/icons/            # Static icon assets
```

## Development

```bash
npm run dev              # Chrome dev mode (HMR)
npm run dev:firefox      # Firefox dev mode
npm run compile          # Type check only
```

## Future Work

- Add adapters for more cascading region, school, and major selectors
- Reconsider Word/PDF profile import only when its value justifies the complexity
- Add conservative, readback-verified support for more date controls and complex tables

## License

Licensed under the [Apache License 2.0](LICENSE).
