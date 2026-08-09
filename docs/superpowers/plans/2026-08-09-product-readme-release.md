# Product README and v1.5.1 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a polished product-facing bilingual README and a verified `v1.5.1` GitHub Release containing current Chrome/Edge and Firefox packages.

**Architecture:** Treat the README as a product landing page backed by verified feature statements and sanitized current screenshots. Version metadata will have one source of truth in package files, and release artifacts will be generated only after the autofill regression suite passes.

**Tech Stack:** Markdown, WXT, TypeScript, Git, GitHub CLI, Chrome/Edge and Firefox extension packaging.

## Global Constraints

- Implement only after the autofill regression plan passes.
- Product name is `保填`; old `秒填鸭` branding must not remain in current screenshots or primary copy.
- Release version is `1.5.1`.
- No personal profile data, API key, cookies, login state, real application URL, or private material may appear in tracked assets or release files.
- The release must not claim automatic final submission or universal website compatibility.

---

### Task 1: Update the version and release metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/releases/v1.5.1.md`

- [ ] **Step 1: Bump the patch version**

Set package and lockfile versions to `1.5.1`, then run the build preparation needed for WXT to regenerate manifests.

- [ ] **Step 2: Write release notes**

Document the three regression fixes, current 1.5 capabilities, installation steps, upgrade/data-backup reminder, privacy model, and known limitations. State that final submission and high-risk choices remain manual.

- [ ] **Step 3: Verify generated manifest versions**

Build Chrome and Firefox and assert both generated manifests report `1.5.1` and product name `保填`.

- [ ] **Step 4: Commit version and release notes**

```text
git add package.json package-lock.json docs/releases/v1.5.1.md
git commit -m "chore: prepare v1.5.1 release"
```

### Task 2: Capture sanitized current screenshots

**Files:**
- Replace: `assets/1-popup.png`
- Replace: `assets/2-filling.png`
- Replace: `assets/3-page.png`
- Optionally create: `assets/4-profile.png`

- [ ] **Step 1: Prepare demo-only data**

Use fictional names and values in an isolated browser profile or local fixture. Do not use the user’s saved profile or logged-in application pages.

- [ ] **Step 2: Capture current product views**

Capture the current site/task summary, field scan/readback view, and precise profile section view. Add the material preview/audit view only if it is visually stable and contains no private content.

- [ ] **Step 3: Inspect every image**

Verify visually that all screenshots show `保填`, contain no old branding, and contain no personal or authentication data. Use consistent viewport, crop, and scale.

- [ ] **Step 4: Commit screenshots**

```text
git add assets/1-popup.png assets/2-filling.png assets/3-page.png assets/4-profile.png
git commit -m "docs: refresh product screenshots"
```

### Task 3: Rewrite the Chinese and English READMEs

**Files:**
- Replace: `README.md`
- Replace: `README.en.md`

- [ ] **Step 1: Build the product hero**

Add centered logo, product name, one-line value statement, version/license/platform badges, and direct anchors for download, quick start, and privacy.

- [ ] **Step 2: Present current capabilities concisely**

Use a compact feature table and explicit `v1.5.1` highlights. Explain the seven precise research/experience/output groups plus the optional `学习与工作履历` compatibility group without calling it an eighth research-output group.

- [ ] **Step 3: Add installation and update troubleshooting**

Document Release packages and unpacked-extension loading. Include the verified remedy for “reload still shows the old version”: inspect the extension card’s load path and the loaded directory’s `manifest.json`, keep a stable directory/ID, and export data before removing or changing the extension instance.

- [ ] **Step 4: Add AI, privacy, and safety boundaries**

Describe local-first matching, optional Chat Completions/Responses API, Fast mode, cache, materials preview, and final audit. State exactly which actions remain manual.

- [ ] **Step 5: Put developer details at the end**

List build, test, package, stack, and project structure after user-facing sections. Link the privacy policy and design documents rather than duplicating internal details.

- [ ] **Step 6: Validate Markdown and stale branding**

Check links, image paths, code blocks, heading hierarchy, and search tracked primary docs/assets for stale `秒填鸭`, `1.4.0`, and old three-group copy.

- [ ] **Step 7: Commit bilingual README**

```text
git add README.md README.en.md
git commit -m "docs: redesign product readme"
```

### Task 4: Build and inspect release packages

**Files:**
- Generate: `.output/baotian-1.5.1-chrome.zip`
- Generate: `.output/baotian-1.5.1-firefox.zip`

- [ ] **Step 1: Run full verification**

Run every `test:*` script, `npm run compile`, Chrome build, Firefox build, and production dependency audit.

- [ ] **Step 2: Generate packages**

Run `npm run zip` and `npm run zip:firefox`. Rename only if WXT’s deterministic output name differs from the documented release filename, without changing archive contents.

- [ ] **Step 3: Inspect archive contents**

List both archives and verify manifest version/name, required extension files, and absence of source browser profiles, user JSON, API secrets, `.env` files, and unrelated old archives.

- [ ] **Step 4: Commit final tracked changes**

Do not commit `.output` unless repository policy explicitly tracks build artifacts. Commit only intentional source, docs, and asset changes.

### Task 5: Push, tag, and publish GitHub Release

**Files:**
- External state: `origin/main`, Git tag `v1.5.1`, GitHub Release `保填 v1.5.1`

- [ ] **Step 1: Verify repository state**

Confirm the working tree is clean, `origin/main` target is correct, and the final local commit contains all intended changes.

- [ ] **Step 2: Push main**

Push the verified commits to `origin/main` and confirm the remote head matches the local commit.

- [ ] **Step 3: Create and push tag**

Create annotated tag `v1.5.1` on the verified final commit and push it. Do not move `v1.5.0`.

- [ ] **Step 4: Create the Release**

Create a non-draft, non-prerelease GitHub Release titled `保填 v1.5.1`, use `docs/releases/v1.5.1.md` as notes, and attach both verified browser packages.

- [ ] **Step 5: Verify public release state**

Read the published release back from GitHub and verify tag, title, published status, attachment names/sizes, and download links. Confirm the repository homepage renders the new Chinese README.

