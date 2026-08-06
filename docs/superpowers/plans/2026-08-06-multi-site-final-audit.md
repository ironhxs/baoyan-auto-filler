# Multi-Site Final Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `v1.3.3` so multiple school application tabs run independently, survive tab closure as local tasks, show the current site first, and support a manually confirmed AI final audit across selected sites and materials.

**Architecture:** Keep transient browser control keyed by `tabId`, but persist application-domain state as `ApplicationTask` records in `chrome.storage.local`. Create pure task/audit/material modules so Node scripts can verify behavior before background, content-script, popup, and audit-page integration. The final audit collects sanitized snapshots, deterministically samples material pages, uses Responses multimodal input when supported, falls back explicitly, and never mutates or submits a website.

**Tech Stack:** TypeScript 5.9, WXT 0.20, Chrome MV3 APIs, IndexedDB, `pdf-lib`, `pdfjs-dist`, vanilla HTML/CSS/TypeScript, Node assertion scripts, Puppeteer for real-browser validation.

## Global Constraints

- Release version is exactly `1.3.3`.
- The popup is current-site-first; the full multi-site report lives in `entrypoints/audit/`.
- Application tasks persist in `chrome.storage.local`; `tabId -> taskId` bindings remain session-only.
- Local scans may run concurrently; AI requests have a process-wide concurrency limit of 2.
- Final audit is manual, requires a preflight plus second confirmation, and is read-only.
- Never collect or send passwords, CAPTCHA, cookies, API keys, CSRF values, authorization headers, or hidden session fields.
- Never click final submit, confirm, payment, agreement, volunteer/adviser selection, or CAPTCHA controls.
- Do not add SEU-specific routing, DOM selectors, or text matching to production core logic.
- Do not commit browser profiles, API credentials, personal information, downloaded application files, screenshots, or test artifacts.

---

### Task 1: Persistent Application Task Domain

**Files:**
- Create: `utils/application-tasks.ts`
- Create: `scripts/test-application-tasks.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `ApplicationTask`, `ApplicationPageSnapshot`, `ApplicationMaterialSnapshot`, and `TaskAuditState`.
- Produces pure helpers `createApplicationTask`, `upsertTaskPage`, `updateTaskFromAutoRun`, `sortTasksForCurrentSite`, and `selectDefaultAuditTaskIds`.
- Produces storage helpers `getApplicationTasks`, `getApplicationTask`, `saveApplicationTask`, `archiveApplicationTask` using key `applicationTasks:v1`.

- [ ] **Step 1: Write the failing task-domain test**

```ts
const task = createApplicationTask({
  id: 'task-a', batchId: 'batch-1', siteOrigin: 'https://a.example',
  siteTitle: 'A 大学', page: firstPage, now: 100,
});
assert.equal(task.status, 'stopped');
assert.deepEqual(task.pageOrder, [firstPage.id]);

const updated = upsertTaskPage(task, { ...firstPage, capturedAt: 200 });
assert.equal(updated.pageOrder.length, 1);
assert.equal(updated.pages[firstPage.id].capturedAt, 200);

const visible = sortTasksForCurrentSite([otherTask, updated], 'task-a');
assert.equal(visible[0].id, 'task-a');
assert.deepEqual(selectDefaultAuditTaskIds([updated, pausedTask, archivedTask], 'batch-1'), ['task-a', 'task-b']);
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npx tsx scripts/test-application-tasks.ts`

Expected: FAIL because `utils/application-tasks.ts` does not exist.

- [ ] **Step 3: Implement the minimal domain and storage adapter**

```ts
export const APPLICATION_TASKS_KEY = 'applicationTasks:v1';

export interface ApplicationTask {
  id: string;
  batchId: string;
  siteOrigin: string;
  siteTitle: string;
  displayName: string;
  status: 'running' | 'paused' | 'complete' | 'stopped' | 'archived';
  pauseReason?: 'materials' | 'required' | 'navigation' | 'api' | 'page' | 'error';
  pageOrder: string[];
  pages: Record<string, ApplicationPageSnapshot>;
  materials: ApplicationMaterialSnapshot[];
  audit?: TaskAuditState;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export function upsertTaskPage(task: ApplicationTask, page: ApplicationPageSnapshot): ApplicationTask {
  const pageOrder = task.pageOrder.includes(page.id) ? task.pageOrder : [...task.pageOrder, page.id];
  return { ...task, pageOrder, pages: { ...task.pages, [page.id]: page }, updatedAt: page.capturedAt };
}
```

- [ ] **Step 4: Add `test:tasks` and verify GREEN**

Run: `npm run test:tasks`

Expected: `application task tests passed`.

- [ ] **Step 5: Commit the task domain**

```bash
git add utils/application-tasks.ts scripts/test-application-tasks.ts package.json
git commit -m "feat: persist application task records"
```

---

### Task 2: Sanitized Audit Snapshots, Fingerprints, and Report Parsing

**Files:**
- Create: `utils/final-audit.ts`
- Create: `scripts/test-final-audit.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes `ApplicationTask` domain types and existing `FormFieldInfo`, `MatchResult`, `ProfileSourceValue`.
- Produces `buildPageSnapshot`, `buildAuditPreflight`, `buildAuditFingerprint`, `parseFinalAuditReport`, `isSensitiveAuditField`, and `samplePdfPages`.
- Produces `FinalAuditReport`, `FinalAuditIssue`, `AuditPreflight`, and `AuditMaterialInput`.

- [ ] **Step 1: Write failing tests for security filtering and stable behavior**

```ts
assert.equal(isSensitiveAuditField({ type: 'password', name: 'password' }), true);
assert.equal(isSensitiveAuditField({ type: 'hidden', name: '_csrf' }), true);
assert.equal(isSensitiveAuditField({ type: 'text', label: '身份证号码' }), false);
assert.deepEqual(samplePdfPages(1, false), [1]);
assert.deepEqual(samplePdfPages(2, true), [1, 2]);
assert.deepEqual(samplePdfPages(8, false), [1, 4, 8]);
assert.equal(buildAuditFingerprint(input), buildAuditFingerprint(structuredClone(input)));
assert.notEqual(buildAuditFingerprint(input), buildAuditFingerprint(changedInput));
assert.equal(parseFinalAuditReport('```json\n{"summary":{"critical":0,"warning":1,"info":0},"issues":[],"unchecked":[],"confirmed":[]}\n```').summary.warning, 1);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx scripts/test-final-audit.ts`

Expected: FAIL because the audit module does not exist.

- [ ] **Step 3: Implement deterministic sanitization and parsing**

```ts
const SENSITIVE_PATTERN = /password|passwd|captcha|验证码|csrf|xsrf|token|cookie|authorization|session|会话/i;

export function isSensitiveAuditField(field: Partial<FormFieldInfo>): boolean {
  if (field.type === 'password') return true;
  const clues = [field.name, field.id, field.label, field.ariaLabel, field.placeholder].filter(Boolean).join(' ');
  if (SENSITIVE_PATTERN.test(clues)) return true;
  return field.type === 'hidden';
}

export function samplePdfPages(pageCount: number, identityDocument: boolean): number[] {
  if (pageCount <= 0) return [];
  if (identityDocument || pageCount <= 3) return Array.from({ length: pageCount }, (_, index) => index + 1);
  return [...new Set([1, Math.ceil(pageCount / 2), pageCount])];
}
```

- [ ] **Step 4: Add `test:audit` and verify GREEN**

Run: `npm run test:audit`

Expected: `final audit core tests passed`.

- [ ] **Step 5: Commit the audit core**

```bash
git add utils/final-audit.ts scripts/test-final-audit.ts package.json
git commit -m "feat: add final audit core"
```

---

### Task 3: AI Concurrency Queue and Multimodal Request Protocol

**Files:**
- Create: `utils/ai-request-queue.ts`
- Create: `scripts/test-ai-request-queue.ts`
- Modify: `utils/matcher.ts`
- Modify: `scripts/test-llm-api.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces singleton `aiRequestQueue` and class `AiRequestQueue(limit)` with `run<T>(job)`.
- Produces matcher helpers `getAuditRequestBody`, `requestAuditModel`, and `isUnsupportedMultimodalError`.
- `requestAuditModel` consumes prompt text plus zero or more `{ mimeType, dataUrl, filename, pageNumber }` visual inputs.

- [ ] **Step 1: Write failing queue and request-shape tests**

```ts
const queue = new AiRequestQueue(2);
let active = 0;
let peak = 0;
await Promise.all(Array.from({ length: 5 }, () => queue.run(async () => {
  active++;
  peak = Math.max(peak, active);
  await tick();
  active--;
})));
assert.equal(peak, 2);

assert.deepEqual(getAuditRequestBody(responsesConfig, 'audit', [image]), {
  model: 'test-model', stream: false, store: false,
  input: [{ role: 'user', content: [
    { type: 'input_text', text: 'audit' },
    { type: 'input_image', image_url: image.dataUrl },
  ] }],
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx scripts/test-ai-request-queue.ts`

Expected: FAIL because the queue module and audit request helpers are missing.

- [ ] **Step 3: Implement the queue and Responses audit request**

```ts
export class AiRequestQueue {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    try { return await job(); }
    finally { this.active--; this.waiters.shift()?.(); }
  }
}
export const aiRequestQueue = new AiRequestQueue(2);
```

Chat Completions receives text-only fallback. Responses first attempts `input_image`; HTTP `400`, `404`, `415`, or an explicit unsupported-input error retries once with text-only content and returns a degradation flag.

- [ ] **Step 4: Verify protocol and concurrency GREEN**

Run: `npm run test:llm-api`

Run: `npm run test:ai-queue`

Expected: both scripts pass and confirm peak concurrency is 2.

- [ ] **Step 5: Commit protocol support**

```bash
git add utils/ai-request-queue.ts utils/matcher.ts scripts/test-ai-request-queue.ts scripts/test-llm-api.mjs package.json
git commit -m "feat: queue AI requests and support audit images"
```

---

### Task 4: Bind Auto-Run Tabs to Persistent Tasks

**Files:**
- Modify: `entrypoints/background.ts`
- Modify: `entrypoints/content.ts`
- Modify: `scripts/test-application-tasks.ts`
- Modify: `ref/material-form-test.html`

**Interfaces:**
- Adds runtime messages `getCurrentApplicationTask`, `listApplicationTasks`, `archiveApplicationTask`, and `openAuditCenter`.
- Extends `AutoRunState` with `taskId` and `batchId`.
- Uses session key `applicationTaskBindings:v1` for `tabId -> taskId`.
- Content script adds `getAuditPageSnapshot` returning visible page label, sanitized field metadata, and visible same-origin material download candidates.

- [ ] **Step 1: Add failing task-binding and snapshot tests**

Extend `scripts/test-application-tasks.ts` to prove:

```ts
const bindings = bindTaskToTab({}, 11, 'task-a');
assert.equal(bindings['11'], 'task-a');
assert.deepEqual(unbindTaskFromTab(bindings, 11), {});
assert.equal(tasksAfterUnbind[0].id, 'task-a');
```

Add fixture fields named `_csrf`, `captchaToken`, and `password`; the snapshot builder must exclude them while preserving visible application fields.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:tasks`

Expected: FAIL because binding helpers are missing.

- [ ] **Step 3: Implement persistent task mirroring**

When `startAutoRun` is received:

```ts
const task = await ensureTaskForTab(tab, previous?.taskId);
const state: AutoRunState = { ...previousState, taskId: task.id, batchId: task.batchId, tabId: tab.id };
await Promise.all([saveAutoRunState(state), saveApplicationTask(updateTaskFromAutoRun(task, state))]);
```

After each scan and after-fill readback, convert `ScanSuccessResponse` to `ApplicationPageSnapshot` and upsert it. On `tabs.onRemoved`, remove session state and binding only; never delete the task.

- [ ] **Step 4: Verify task and existing regression suites GREEN**

Run: `npm run test:tasks`

Run: `npm run test:local-matcher`

Run: `npm run test:profile`

Expected: all pass.

- [ ] **Step 5: Commit task integration**

```bash
git add entrypoints/background.ts entrypoints/content.ts scripts/test-application-tasks.ts ref/material-form-test.html
git commit -m "feat: bind auto-run tabs to persistent tasks"
```

---

### Task 5: Material Page Extraction and Audit Orchestration

**Files:**
- Create: `utils/material-audit.ts`
- Create: `scripts/test-material-audit.ts`
- Modify: `entrypoints/background.ts`
- Modify: `utils/db.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Adds dependency `pdfjs-dist`.
- Produces `inspectPdfMaterial(blob, options)`, returning page count, selected page text, and optional JPEG data URLs.
- Produces `collectTaskAuditInput(task)` and `runFinalAudit(taskIds, force)`.
- Website material downloads are allowed only for visible same-origin URLs captured by the content script and use `credentials: 'include'`.

- [ ] **Step 1: Write failing material tests**

Use `pdf-lib` in the test to create an eight-page PDF, then assert:

```ts
const inspected = await inspectPdfMaterial(pdfBlob, { identityDocument: false, renderImages: false });
assert.equal(inspected.pageCount, 8);
assert.deepEqual(inspected.selectedPages.map((page) => page.pageNumber), [1, 4, 8]);
assert.match(inspected.selectedPages[0].text, /Page 1/);
assert.equal(isAllowedVisibleMaterialUrl('https://a.example/file.pdf', 'https://a.example'), true);
assert.equal(isAllowedVisibleMaterialUrl('https://evil.example/file.pdf', 'https://a.example'), false);
```

- [ ] **Step 2: Install dependency and verify RED remains feature-related**

Run: `npm install pdfjs-dist`

Run: `npx tsx scripts/test-material-audit.ts`

Expected: FAIL because `inspectPdfMaterial` is not implemented, not because the dependency is unavailable.

- [ ] **Step 3: Implement PDF inspection and final-audit orchestration**

Use `pdfjs-dist/legacy/build/pdf.mjs` with a `Uint8Array`. Extract text for every selected page. Render at scale `1.25` only when visual input is requested. Compress images as JPEG at quality `0.78`. Cap visual pages at 12 per unified run; all text-capable pages still contribute text, and overflow visual pages enter `unchecked` with reason `visual_page_limit`.

`runFinalAudit` must:

1. Load selected non-archived tasks and profile values.
2. Build preflight and fingerprint.
3. Reuse a matching cached report unless `force` is true.
4. Resolve website or local material sources.
5. Call `requestAuditModel` through `aiRequestQueue`.
6. Parse and persist a report only after valid JSON.
7. Preserve a previous valid report when the new attempt fails.

- [ ] **Step 4: Verify material and audit suites GREEN**

Run: `npm run test:material-audit`

Run: `npm run test:audit`

Run: `npm run test:llm-api`

Expected: all pass with no unhandled worker or canvas errors.

- [ ] **Step 5: Commit material audit**

```bash
git add utils/material-audit.ts utils/db.ts entrypoints/background.ts scripts/test-material-audit.ts package.json package-lock.json
git commit -m "feat: audit sampled material pages"
```

---

### Task 6: Dedicated Unified Audit Center

**Files:**
- Create: `entrypoints/audit/index.html`
- Create: `entrypoints/audit/main.ts`
- Create: `entrypoints/audit/style.css`
- Create: `utils/audit-view-model.ts`
- Create: `scripts/test-audit-view-model.ts`
- Modify: `entrypoints/background.ts`

**Interfaces:**
- Audit page consumes runtime messages `listApplicationTasks`, `getAuditPreflight`, `runFinalAudit`, `archiveApplicationTask`, and `focusApplicationTask`.
- `getAuditPreflight` returns exact selected task/page/field/material/sample counts and degradation notices without calling the API.
- `runFinalAudit` requires `confirmed: true` and rejects direct calls without confirmation.
- `buildAuditViewModel` produces current-first task rows, selected IDs, preflight confirmation state, and severity-grouped report rows for the real UI.

- [ ] **Step 1: Add a failing audit view-model behavior test**

Create `scripts/test-audit-view-model.ts` and assert observable UI state from real task/report inputs:

```ts
const model = buildAuditViewModel([otherTask, currentTask], {
  currentTaskId: currentTask.id,
  batchId: currentTask.batchId,
  selectedTaskIds: new Set([otherTask.id, currentTask.id]),
  preflight: { taskCount: 2, pageCount: 9, fieldCount: 80, materialCount: 7, sampledPageCount: 12, notices: [] },
  confirmed: false,
});
assert.equal(model.tasks[0].id, currentTask.id);
assert.equal(model.tasks[0].isCurrent, true);
assert.equal(model.runDisabled, true);
assert.equal(model.preflightLabel, '2 所学校 · 9 个页面 · 7 份材料 · 12 个抽样页');

const grouped = groupAuditIssues(report);
assert.equal(grouped.critical[0].severity, 'critical');
assert.equal(grouped.warning[0].severity, 'warning');
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx scripts/test-audit-view-model.ts`

Expected: FAIL because `utils/audit-view-model.ts` does not exist.

- [ ] **Step 3: Implement the audit page**

Build a restrained full-page work surface:

- Task checklist with current task first and highlighted.
- Site status, pages, conflicts, material counts, and last audit time.
- Preflight modal showing exact outbound scope and a required confirmation checkbox.
- Report groups ordered `critical`, `warning`, `unchecked`, `confirmed`.
- Actions to focus an already-open task tab or open the saved site URL; no automatic navigation.
- Archive action with local confirmation.

Do not use cards inside cards, large hero typography, decorative gradients, or marketing copy.

- [ ] **Step 4: Verify UI contract and compile GREEN**

Run: `npm run test:audit-view-model`

Run: `npm run compile`

Expected: both pass.

- [ ] **Step 5: Commit audit center**

```bash
git add entrypoints/audit entrypoints/background.ts utils/audit-view-model.ts scripts/test-audit-view-model.ts package.json
git commit -m "feat: add unified audit center"
```

---

### Task 7: Current-Site-First Popup

**Files:**
- Modify: `entrypoints/popup/main.ts`
- Modify: `entrypoints/popup/style.css`
- Modify: `utils/audit-view-model.ts`
- Modify: `scripts/test-audit-view-model.ts`

**Interfaces:**
- Popup loads `getCurrentApplicationTask` and `listApplicationTasks` during initialization.
- Current task status and history occupy the main auto-run area.
- Batch summary remains one compact footer band with `openAuditCenter`.
- `buildPopupTaskSummary` derives current-site counts and batch totals consumed by popup rendering.

- [ ] **Step 1: Extend the view-model behavior test and verify RED**

```ts
const popup = buildPopupTaskSummary([otherTask, currentTask], currentTask.id);
assert.equal(popup.current?.id, currentTask.id);
assert.equal(popup.current?.conflicts, 2);
assert.equal(popup.batch.total, 2);
assert.equal(popup.batch.needsReview, 1);
```

Run: `npm run test:audit-view-model`

Expected: FAIL because `buildPopupTaskSummary` does not exist.

- [ ] **Step 2: Implement current-site-first rendering**

Keep existing scan, manual fill, material review, and auto-run controls. Add:

- Site name and task state above auto-run history.
- Current page, verified, conflict, missing, and material counts.
- Last audit summary when available.
- Compact batch summary below the current-site detail.
- Full-width command `打开统一审核` that opens the audit page.

- [ ] **Step 3: Verify popup contract, compile, and existing tests GREEN**

Run: `npm run test:audit-view-model`

Run: `npm run compile`

Run: `npm run test:local-matcher`

Expected: all pass.

- [ ] **Step 4: Commit popup integration**

```bash
git add entrypoints/popup/main.ts entrypoints/popup/style.css utils/audit-view-model.ts scripts/test-audit-view-model.ts
git commit -m "feat: prioritize current site in popup"
```

---

### Task 8: Release Metadata, Documentation, and End-to-End Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `ref/material-form-test.html`
- Create: `ref/multi-site-form-test.html`

**Interfaces:**
- Release artifact reports `1.3.3` and name `保填`.
- README documents current-site-first display, persistent multi-site tasks, manual final audit, material degradation, and privacy confirmation.

- [ ] **Step 1: Update version and docs**

Set package and lockfile version to `1.3.3`. Add the accepted workflow without promising universal multimodal support.

- [ ] **Step 2: Run the full automated verification suite**

Run in this order:

```bash
npm run compile
npm run test:local-matcher
npm run test:profile
npm run test:llm-api
npm run test:tasks
npm run test:audit
npm run test:ai-queue
npm run test:material-audit
npm run test:audit-view-model
npm run build
git diff --check
```

Expected: every command exits 0; manifest name is `保填`, version is `1.3.3`.

- [ ] **Step 3: Validate two-site concurrency in the controlled browser**

The flow under test is: two local origins open in separate tabs -> start auto-run in both -> each tab shows its own current-site task -> AI jobs peak at 2 or less -> close one tab -> its task remains in the audit center.

Collect page identity, DOM snapshots, console warnings/errors, interaction proof, and screenshots outside committed source.

- [ ] **Step 4: Validate the real logged-in SEU system read-only**

The flow under test is: SEU application page -> collect all visible step/page snapshots and material metadata -> open audit center -> SEU appears first as current task -> preflight shows exact counts -> cancel before API once, then run confirmed audit -> report renders without any form mutation or submit navigation.

Explicitly verify URL never enters or activates the final submit action. Do not click “申请信息提交”.

- [ ] **Step 5: Copy the verified build to the stable Edge unpacked directory**

Replace only the contents of:

`C:\Users\Iron\AppData\Local\Microsoft\Edge\User Data\Default\UnpackedExtensions\baoyan-auto-filler-responses-chrome_32552_467778428`

with `.output/chrome-mv3`, then reload the extension and re-run the popup/audit smoke check.

- [ ] **Step 6: Final commit, tag, and push**

```bash
git add README.md package.json package-lock.json ref/multi-site-form-test.html ref/material-form-test.html
git commit -m "feat: release baotian 1.3.3"
git tag -a v1.3.3 -m "保填 v1.3.3"
git push origin main
git push origin v1.3.3
```

Before pushing, verify no secrets, personal data, browser artifacts, downloaded files, or screenshots are staged.
