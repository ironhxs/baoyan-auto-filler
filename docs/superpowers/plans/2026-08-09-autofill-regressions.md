# Autofill Regression Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop irrelevant repeatable groups from pausing a page, prevent project records from entering education/work timelines, and make school/department/major dialog selectors write and verify the correct field.

**Architecture:** Keep deterministic matching and page automation separate. Repeatable planning will retain all saved source data but page preparation will act only on a table that the current DOM identifies with strong local evidence. The generic `学习和工作经历` projection will be replaced by an explicit `education_career` record shape. Dialog selection will bind one field to one trigger and one newly opened dialog root before clicking any candidate or confirmation control.

**Tech Stack:** TypeScript, WXT Manifest V3 extension, IndexedDB, Node `assert`, Puppeteer-based browser checks where DOM integration is required.

## Global Constraints

- Never click final submission, confirmation submission, payment, captcha, commitment, preference, or advisor controls.
- Never infer missing dates, schools, units, or positions from unrelated project text.
- Preserve manually entered page values and require readback evidence before reporting a successful fill.
- Do not commit user profile JSON, API keys, browser cookies, login state, or screenshots containing personal information.
- Version target for the combined release is `1.5.1`.

---

### Task 1: Reproduce the three regressions with failing tests

**Files:**
- Modify: `scripts/test-repeatable-records.ts`
- Modify: `scripts/test-repeatable-row-request.ts`
- Create: `scripts/test-dialog-selection.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `planRepeatableRecords(fields, blocks, textFields)` and repeat-row request helpers.
- Produces: deterministic failing assertions for page scoping, chronology projection, and dialog-control selection.

- [ ] **Step 1: Add the absent-page repeatable regression**

Add a case with only flat “基本信息” fields and saved family/language/research/award blocks. Assert that the repeat-row preparation contract treats unavailable groups as not present on the current page rather than failures requiring attention.

- [ ] **Step 2: Add the chronology projection regression**

Create a page group named `学习和工作经历` with columns `起始时间`, `结束时间`, `学校或工作单位`, and `担任职务`. Provide `research_training`, `internship_practice`, and `social_work` records and assert that none are bound to the chronology rows merely because the group title contains “经历”.

- [ ] **Step 3: Add dialog-selection decision regressions**

In `scripts/test-dialog-selection.ts`, model three fields named `所在学校`, `所在院系`, and `所在专业`, each with its own trigger. Assert:

```ts
assert.equal(selectScopedTrigger(candidates, 'school-input'), 'school-trigger');
assert.equal(selectScopedTrigger(candidates, 'department-input'), 'department-trigger');
assert.equal(selectScopedTrigger(candidates, 'major-input'), 'major-trigger');
```

Add a second case with two visible dialogs and assert that only a unique newly opened dialog can be selected. Add a third case asserting that a confirmation button outside the selected dialog is rejected.

- [ ] **Step 4: Register and run the failing tests**

Add `test:dialog-selection` to `package.json`, then run:

```text
npm run test:repeatable-records
npm run test:repeatable-row-request
npm run test:dialog-selection
```

Expected: at least one assertion fails for each reported regression before implementation.

- [ ] **Step 5: Commit the regression tests**

```text
git add scripts/test-repeatable-records.ts scripts/test-repeatable-row-request.ts scripts/test-dialog-selection.ts package.json package-lock.json
git commit -m "test: reproduce autofill page regressions"
```

### Task 2: Scope repeatable row preparation to the current page

**Files:**
- Modify: `entrypoints/content.ts`
- Modify: `utils/repeatable-records.ts`
- Test: `scripts/test-repeatable-row-request.ts`
- Test: `scripts/test-repeatable-records.ts`

**Interfaces:**
- Consumes: table headers, nearest visible heading text, and `RepeatRowTarget[]`.
- Produces: a repeat-row preparation result in which absent groups are ignored and present-but-unfillable groups remain actionable failures.

- [ ] **Step 1: Strengthen table identity**

Change `findRepeatTable(groupLabel)` so fallback detection uses the table’s own header/caption or nearest visible section heading. Do not call `detectProfileGroup(findGroupText(table, table))` over broad ancestor/page text, because hidden navigation and unrelated sections can falsely identify a basic-information table as a family table.

- [ ] **Step 2: Distinguish absent from broken tables**

When a target has no strongly identified table on the current page, skip it without adding a failure. When a strongly identified table exists but has no safe add-row/add-record control, retain `No visible add-row control found` as a real failure.

- [ ] **Step 3: Preserve empty-table automation**

Verify that an empty but clearly labelled award/family/language table with a visible add button still receives the required number of rows. The fix must not reduce empty-table support to “only tables that already contain an input row”.

- [ ] **Step 4: Run focused tests**

```text
npm run test:repeatable-row-request
npm run test:repeatable-records
npm run test:repeatable-dialog
```

Expected: all pass, including absent-page and empty-present-table cases.

- [ ] **Step 5: Commit page-scoped repeat preparation**

```text
git add entrypoints/content.ts utils/repeatable-records.ts scripts/test-repeatable-row-request.ts scripts/test-repeatable-records.ts
git commit -m "fix: scope repeatable rows to current page"
```

### Task 3: Replace the unsafe chronology projection

**Files:**
- Modify: `utils/profile-schema.ts`
- Modify: `utils/repeatable-records.ts`
- Modify: `utils/profile-projections.ts`
- Modify: `scripts/test-profile-data.ts`
- Modify: `scripts/test-profile-projections.ts`
- Modify: `scripts/test-repeatable-records.ts`

**Interfaces:**
- Produces section ID `education_career` with fields `起始时间`, `结束时间`, `学校或工作单位`, and `担任职务`.
- Consumes only explicit `education_career` records for pages strongly classified as education/work chronology.

- [ ] **Step 1: Add the precise compatibility section**

Define an optional repeatable section:

```ts
{
  id: 'education_career',
  title: '学习与工作履历',
  kind: 'repeat',
  requiredFields: ['起始时间', '结束时间', '学校或工作单位', '担任职务'],
}
```

Do not populate it by guessing from graduation date, research projects, competitions, awards, or narrative text.

- [ ] **Step 2: Remove the unsafe merged group**

Delete the `学习和工作经历` merged group that concatenates `research_training`, `internship_practice`, and `social_work`. Map `education_career` to page aliases such as `学习和工作经历`, `教育经历`, and `工作经历` only when the target columns express the chronology schema.

- [ ] **Step 3: Keep project projection narrow**

Retain `项目经历 ← 科研训练 + 实习实践 + 社会工作` only for target schemas containing project-specific fields such as `项目名称`, `项目描述`, `项目时间段`, or `本人角色`. A target with `学校或工作单位` and `担任职务` must not satisfy this projection.

- [ ] **Step 4: Verify imports and defaults**

Ensure existing seven precise groups remain intact. Existing users receive an empty `学习与工作履历` section without deleting or rewriting their saved data. JSON import may populate this section when explicitly supplied.

- [ ] **Step 5: Run profile and projection tests**

```text
npm run test:profile
npm run test:profile-projections
npm run test:repeatable-records
npm run test:local-matcher
```

Expected: project/award/paper projections still pass; the chronology anti-projection passes.

- [ ] **Step 6: Commit chronology safety**

```text
git add utils/profile-schema.ts utils/repeatable-records.ts utils/profile-projections.ts scripts/test-profile-data.ts scripts/test-profile-projections.ts scripts/test-repeatable-records.ts
git commit -m "fix: separate education chronology from projects"
```

### Task 4: Bind school, department, and major selectors to one dialog

**Files:**
- Create: `utils/dialog-selection.ts`
- Modify: `entrypoints/content.ts`
- Test: `scripts/test-dialog-selection.ts`

**Interfaces:**
- Produces `selectScopedTrigger`, `selectNewDialogRoot`, `selectScopedConfirm`, and normalized choice comparison helpers.
- Consumes metadata collected from DOM elements without storing personal values.

- [ ] **Step 1: Implement deterministic trigger ranking**

Choose a trigger only when it shares the nearest field row/form-item with the target input. If multiple triggers remain equally plausible, return no trigger and mark the field for review instead of clicking the first `选择` on the page.

- [ ] **Step 2: Capture dialog state before opening**

Before clicking a trigger, capture visible dialog/iframe roots. After clicking, wait for one unique newly visible root associated with the target field. Do not fall back to `document.body` for school, department, or major selection.

- [ ] **Step 3: Scope search, choice, and confirmation**

Search only inside the selected dialog root. Match exact visible text after permitted numeric-code normalization. Click a candidate only when its clickable row/option is unique. Search for `确定/确认/保存` only inside the same dialog footer or form.

- [ ] **Step 4: Verify website state**

After selecting, wait for the target input/display value or its paired hidden value to change. Return success only when `dialogValueMatches(target, expected)` succeeds. Never report another field’s value as the selected value.

- [ ] **Step 5: Run selector tests and compile**

```text
npm run test:dialog-selection
npm run compile
npm run build
```

Expected: all pass and the production content script includes the scoped selector path.

- [ ] **Step 6: Commit selector binding**

```text
git add utils/dialog-selection.ts entrypoints/content.ts scripts/test-dialog-selection.ts package.json package-lock.json
git commit -m "fix: bind dialog choices to target field"
```

### Task 5: Verify the regression fixes in a safe browser session

**Files:**
- Modify only if needed: `qa/` non-sensitive test fixture files
- Do not commit: browser profiles, cookies, screenshots containing personal data

**Interfaces:**
- Consumes: built `.output/chrome-mv3` extension.
- Produces: observed fill/readback results without submitting any application.

- [ ] **Step 1: Build and load the updated extension**

Run `npm run build`, update the fixed unpacked-extension directory, and reload the extension. Confirm the manifest version after the version task is applied.

- [ ] **Step 2: Recheck the basic-information page**

Scan a page without repeatable tables. Expected: no “Repeatable rows need attention” entry for absent family/language/research/award groups and no pause caused solely by those groups.

- [ ] **Step 3: Recheck the learning-information selectors**

Fill only `所在学校`, `所在院系`, and `所在专业`. Expected: each field opens its own selector, receives its own saved value, and passes readback. Stop before clicking “下一步” if a selector remains ambiguous.

- [ ] **Step 4: Recheck education/work chronology**

Scan the table with columns `起始时间`, `结束时间`, `学校或工作单位`, and `担任职务`. Expected: no research/project rows are proposed. If `education_career` is empty, the page stays unmatched and explains that chronology data is missing.

- [ ] **Step 5: Run the complete regression suite**

Run all package tests, `npm run compile`, `npm run build`, and `npm audit --omit=dev --audit-level=high` before release work begins.

