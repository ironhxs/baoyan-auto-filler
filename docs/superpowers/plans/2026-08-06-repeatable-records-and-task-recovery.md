# Repeatable Records and Task Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeatable application records safe to verify and add, while keeping scan results and continuous filling independently recoverable for every project and semantic page.

**Architecture:** A pure `repeatable-records` planner will bind saved repeatable data to existing page rows using group-specific identity fields before considering row position. `ApplicationTask` will own durable page analyses and runner checkpoints; the background service will mirror the current tab state into those records and restore it on navigation or activation. The content script remains responsible only for DOM discovery, safe row addition, filling and marking.

**Tech Stack:** TypeScript, WXT/Manifest V3, Chrome `storage.local`, Chrome `storage.session`, Chrome tab/alarms APIs, `tsx` assertion scripts, Puppeteer against user-authenticated Edge only for no-submit QA.

## Global Constraints

- Keep matching generic; do not add production selectors, URLs, routes or copy that target Sun Yat-sen University or any single school.
- Never click final submit/confirm, captcha, payment, commitment, mentor or volunteer controls.
- Reuse the existing semantic page key (`canonicalPageUrl` + DOM signature) for page identity.
- A pre-filled non-empty repeatable row must never be overwritten merely because its ordinal differs from stored data.
- AI calls are optional. A page analysis with the same semantic key must restore without a fresh AI request.
- Bump the extension version from `1.3.4` for the release; commit, push `main`, and push a matching version tag after verification.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `utils/repeatable-records.ts` | Pure row identity, binding and row-addition planning. No browser APIs. |
| `scripts/test-repeatable-records.ts` | Regression coverage for reversed existing rows, empty tables and non-overwrite behavior. |
| `utils/local-matcher.ts` | Use planner-produced item identity instead of raw `rowIndex` when matching repeatable fields. |
| `entrypoints/content.ts` | Describe existing rows and perform bounded, observable add-row actions. |
| `utils/application-tasks.ts` | Durable `pageAnalyses` and `runner` checkpoint types plus immutable update helpers. |
| `scripts/test-application-tasks.ts` | Verify independent project state and analysis updates. |
| `entrypoints/background.ts` | Persist/restore analyses, plan row additions, use task checkpoints and durable resume alarms. |
| `entrypoints/popup/main.ts` | Restore cached scan results and show repeat-row plan summary. |
| `scripts/test-page-analysis-recovery.ts` | Validate semantic cache reuse vs invalidation and runner resume rules. |
| `package.json` | Add test script(s) and release version. |
| `README.md` | Explain automatic repeat-row addition, task recovery and non-submit guarantee. |

## Task 1: Add a pure repeatable-record planner

**Files:**
- Create: `utils/repeatable-records.ts`
- Create: `scripts/test-repeatable-records.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `BlockCategory` from `utils/db.ts`, `FormFieldInfo` from `utils/matcher.ts`.
- Produces: `planRepeatableRecords(fields, blocks, textFields): RepeatableRecordPlan`.
- Produces: `getRepeatableItemKey(groupLabel, fields): string` and `getFieldItemBinding(field, plan): number | undefined` for the local matcher.

- [ ] **Step 1: Write the failing planner test**

```ts
import assert from 'node:assert/strict';
import { planRepeatableRecords } from '../utils/repeatable-records';

const plan = planRepeatableRecords(reversedCetFields, [], cetTextFields);
assert.deepEqual(plan.groups['外语水平'].bindings, [1, 0]);
assert.equal(plan.groups['外语水平'].rowsToAdd, 0);

const emptyAwards = planRepeatableRecords(emptyAwardFields, awardBlocks, []);
assert.equal(emptyAwards.groups['奖励情况'].rowsToAdd, 2);
assert.deepEqual(emptyAwards.groups['奖励情况'].missingItemIndexes, [0, 1]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:repeatable-records`

Expected: FAIL because the script and `planRepeatableRecords` do not exist.

- [ ] **Step 3: Implement the minimal pure planner**

```ts
export interface RepeatableGroupPlan {
  groupLabel: string;
  bindings: Array<number | undefined>;
  missingItemIndexes: number[];
  rowsToAdd: number;
  unmatchedRowIndexes: number[];
}

export interface RepeatableRecordPlan {
  groups: Record<string, RepeatableGroupPlan>;
}

export function planRepeatableRecords(
  fields: FormFieldInfo[],
  blocks: BlockCategory[],
  textFields: TextField[],
): RepeatableRecordPlan {
  // Build page rows by group, bind non-empty identity cells first,
  // then map only empty rows to unbound stored items.
}
```

Implement normalizers for group-specific identity keys:

```ts
const identityKeys: Record<string, string[]> = {
  '外语水平': ['考试名称', '外语水平', '考试类型'],
  '家庭成员': ['姓名', '成员姓名'],
  '学术成果': ['成果名称', '论文名称'],
  '奖励情况': ['奖励名称', '获奖名称', '竞赛名称'],
  '学习和工作经历': ['学校或单位', '开始日期'],
};
```

Only use ordinal fallback for a fully empty page row; mark populated rows without a reliable identity as `unmatchedRowIndexes`.

- [ ] **Step 4: Run the planner test to verify it passes**

Run: `npm run test:repeatable-records`

Expected: PASS and output `repeatable records tests passed`.

- [ ] **Step 5: Commit the planner slice**

```bash
git add utils/repeatable-records.ts scripts/test-repeatable-records.ts package.json
git commit -m "feat: plan repeatable form records by identity"
```

## Task 2: Use identity binding in local repeatable matching

**Files:**
- Modify: `utils/local-matcher.ts:208-238`
- Modify: `scripts/test-local-matcher.ts`

**Interfaces:**
- Consumes: `RepeatableRecordPlan` and `getFieldItemBinding` from `utils/repeatable-records.ts`.
- Produces: Structured local matches whose `fieldKey` points to the item identified by page content, not raw page ordinal.

- [ ] **Step 1: Add a failing reversed-row regression**

```ts
const reversed = matchFieldsLocally([
  field(0, { groupLabel: '外语水平', rowIndex: 0, columnLabel: '考试名称', value: 'CET-6' }),
  field(1, { groupLabel: '外语水平', rowIndex: 0, columnLabel: '成绩', value: '489' }),
  field(2, { groupLabel: '外语水平', rowIndex: 1, columnLabel: '考试名称', value: 'CET-4' }),
  field(3, { groupLabel: '外语水平', rowIndex: 1, columnLabel: '成绩', value: '536' }),
], textFields, blocks);

assert.equal(reversed.find((match) => match.index === 1)?.value, '489');
assert.match(reversed.find((match) => match.index === 1)?.fieldKey ?? '', /外语水平\[2\]/);
```

- [ ] **Step 2: Run the local matcher test to verify it fails**

Run: `npm run test:local-matcher`

Expected: FAIL because row zero is currently bound to the first saved language item.

- [ ] **Step 3: Thread the planner into structured matching**

```ts
function findStructuredMatch(
  field: FormFieldInfo,
  blocks: BlockCategory[],
  textFields: TextField[],
  plan: RepeatableRecordPlan,
): MatchResult | undefined {
  const itemIndex = getFieldItemBinding(field, plan);
  if (itemIndex == null) return undefined;
  // Read the matching saved item and choose the column by semantic key.
}
```

Build one planner per `matchFieldsLocally` call and pass it to every structured field. Preserve existing flat matching, long-field aggregation and protected-field logic.

- [ ] **Step 4: Run the local matcher test to verify it passes**

Run: `npm run test:local-matcher`

Expected: PASS, including the existing structured-column-order tests.

- [ ] **Step 5: Commit the matching slice**

```bash
git add utils/local-matcher.ts scripts/test-local-matcher.ts
git commit -m "fix: bind repeatable fields by existing row identity"
```

## Task 3: Make DOM row addition observable and group-aware

**Files:**
- Modify: `entrypoints/content.ts:361-538`
- Modify: `entrypoints/background.ts:1210-1228`
- Create: `scripts/test-repeatable-row-request.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RepeatableRecordPlan` summaries in the background.
- Produces: content message `prepareRepeatRows` with `{ groupLabel, requiredRows, missingItemIndexes }` and result `{ added, failures }`.

- [ ] **Step 1: Write the failing request-shape test**

```ts
import assert from 'node:assert/strict';
import { buildRepeatRowTargets } from '../utils/repeatable-records';

assert.deepEqual(buildRepeatRowTargets({ groups: {
  '奖励情况': { groupLabel: '奖励情况', bindings: [], missingItemIndexes: [0, 1], rowsToAdd: 2, unmatchedRowIndexes: [] },
} }), [{ groupLabel: '奖励情况', requiredRows: 2, missingItemIndexes: [0, 1] }]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:repeatable-row-request`

Expected: FAIL because target construction does not exist.

- [ ] **Step 3: Implement bounded row preparation and rescan**

```ts
interface PrepareRepeatRowsMessage {
  type: 'prepareRepeatRows';
  targets: Array<{ groupLabel: string; requiredRows: number; missingItemIndexes: number[] }>;
}

interface PrepareRepeatRowsResult {
  added: number;
  failures: Array<{ groupLabel: string; reason: string }>;
}
```

Update `findAddRowControl` to accept visible button, link, role button or clickable `span` with normalized text `新增`, `添加`, `新增一行`, `添加一条` or an accessible add label. Preserve its five-level container limit. Have `prepareRepeatRows` return a failure if no visible control is found or a click fails to increase fields. In `collectTabScan`, first scan fields, create a plan, request only required additions, then scan again and derive matches from the post-addition field set.

- [ ] **Step 4: Run the new and existing tests to verify they pass**

Run: `npm run test:repeatable-row-request; npm run test:repeatable-records; npm run test:local-matcher`

Expected: all three commands PASS.

- [ ] **Step 5: Commit the DOM preparation slice**

```bash
git add entrypoints/content.ts entrypoints/background.ts utils/repeatable-records.ts scripts/test-repeatable-row-request.ts package.json
git commit -m "feat: add missing repeatable rows before filling"
```

## Task 4: Persist per-page analysis and runner checkpoints in tasks

**Files:**
- Modify: `utils/application-tasks.ts`
- Modify: `scripts/test-application-tasks.ts`
- Create: `utils/page-analysis.ts`
- Create: `scripts/test-page-analysis-recovery.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `ApplicationPageAnalysis` with fields, matches, marker items, checked indexes, repeat plan and AI metadata.
- Produces `ApplicationRunnerCheckpoint` with status, last page key, history, pause reason, material confirmation and next-resume timestamp.
- Produces immutable helpers `upsertTaskPageAnalysis`, `getTaskPageAnalysis`, `updateTaskRunnerCheckpoint`.

- [ ] **Step 1: Write failing task persistence tests**

```ts
const withAnalysis = upsertTaskPageAnalysis(taskA, analysisA);
assert.equal(getTaskPageAnalysis(withAnalysis, analysisA.pageKey)?.pageKey, analysisA.pageKey);
assert.equal(getTaskPageAnalysis(withAnalysis, analysisB.pageKey), null);

const withRunner = updateTaskRunnerCheckpoint(withAnalysis, checkpoint);
assert.equal(withRunner.runner?.status, 'running');
assert.equal(taskA.runner, undefined, 'immutable update must not mutate the input task');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:tasks; npm run test:page-analysis-recovery`

Expected: FAIL because page analyses and runner checkpoints are not represented on `ApplicationTask`.

- [ ] **Step 3: Add types and immutable helpers**

```ts
export interface ApplicationPageAnalysis {
  pageKey: string;
  pageLabel: string;
  pageUrl: string;
  pageSignature: string;
  fields: FormFieldInfo[];
  matches: MatchResult[];
  markers: PageMarkerItem[];
  checkedIndexes: number[];
  repeatPlan: RepeatableRecordPlan;
  ai: ScanSuccessResponse['ai'];
  capturedAt: number;
}

export interface ApplicationRunnerCheckpoint {
  status: 'running' | 'paused' | 'complete' | 'stopped';
  lastPageKey?: string;
  history: ApplicationTaskHistoryEntry[];
  pauseReason?: ApplicationTaskPauseReason;
  confirmedMaterialPageKey?: string;
  resumeAfter?: number;
  updatedAt: number;
}
```

Store both properties on `ApplicationTask` as optional fields so existing task records remain readable. Limit analyses to the newest 30 keys and retain all snapshots already used by final audit.

- [ ] **Step 4: Run the task and recovery tests to verify they pass**

Run: `npm run test:tasks; npm run test:page-analysis-recovery`

Expected: PASS.

- [ ] **Step 5: Commit the persistence model slice**

```bash
git add utils/application-tasks.ts utils/page-analysis.ts scripts/test-application-tasks.ts scripts/test-page-analysis-recovery.ts package.json
git commit -m "feat: persist page analysis and runner checkpoints"
```

## Task 5: Restore cached page analyses in the background and popup

**Files:**
- Modify: `entrypoints/background.ts:51-71, 463-528, 902-908, 1086-1245, 1473-1679`
- Modify: `entrypoints/popup/main.ts:16-168, 1000-1071`
- Modify: `scripts/test-page-analysis-recovery.ts`

**Interfaces:**
- Add background message `getCurrentPageAnalysis` returning `{ analysis: ApplicationPageAnalysis | null, currentPageKey: string }`.
- Add `savePageAnalysis(taskId, scan, markers, checkedIndexes, repeatPlan)`.
- Add `restoreAnalysisToTab(tabId, analysis)` returning `true` only when semantic page keys match.

- [ ] **Step 1: Extend the recovery test with cache reuse and invalidation**

```ts
assert.equal(shouldReusePageAnalysis(cached, {
  url: cached.pageUrl,
  label: cached.pageLabel,
  signature: cached.pageSignature,
}), true);
assert.equal(shouldReusePageAnalysis(cached, {
  url: cached.pageUrl,
  label: cached.pageLabel,
  signature: 'different-dom-signature',
}), false);
```

- [ ] **Step 2: Run the recovery test to verify it fails**

Run: `npm run test:page-analysis-recovery`

Expected: FAIL because no page-analysis reuse predicate exists.

- [ ] **Step 3: Implement analysis save/restore flow**

```ts
async function restoreAnalysisToTab(tabId: number, analysis: ApplicationPageAnalysis): Promise<boolean> {
  const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(tabId, { type: 'getPageMeta' });
  if (semanticPageKey(meta) !== analysis.pageKey) return false;
  await sendToContentScript(tabId, { type: 'markPreview', items: analysis.markers });
  return true;
}
```

On popup initialization, request the cached analysis after `inspectPage`. If it matches the current page, convert its fields/matches/checked indexes into `displayItems` and call `renderResult` directly. `startScan` must persist the new analysis after marker construction. A rescan replaces only the same semantic page analysis. When restored field values differ from the saved scan, mark the corresponding display item as `conflict` or `pending`; do not write to the page.

- [ ] **Step 4: Run recovery and compile tests to verify they pass**

Run: `npm run test:page-analysis-recovery; npm run compile`

Expected: PASS with no TypeScript error.

- [ ] **Step 5: Commit the recovery UI slice**

```bash
git add entrypoints/background.ts entrypoints/popup/main.ts scripts/test-page-analysis-recovery.ts
git commit -m "feat: restore cached page analyses and markers"
```

## Task 6: Resume continuous filling from project checkpoints

**Files:**
- Modify: `entrypoints/background.ts:368-461, 902-929, 1131-1207, 1473-1696`
- Modify: `utils/application-tasks.ts`
- Modify: `scripts/test-application-tasks.ts`
- Modify: `scripts/test-page-analysis-recovery.ts`

**Interfaces:**
- Add `scheduleTaskResume(taskId, tabId, delayMs): Promise<void>` using `chrome.alarms`.
- Add `resumeTaskForTab(tabId): Promise<void>` that loads the bound task checkpoint and only processes `running` tasks.

- [ ] **Step 1: Add failing independent-project and resume-status tests**

```ts
const first = updateTaskRunnerCheckpoint(taskA, { ...checkpoint, status: 'running' });
const second = updateTaskRunnerCheckpoint(taskB, { ...checkpoint, status: 'paused' });
assert.equal(canResumeRunner(first.runner), true);
assert.equal(canResumeRunner(second.runner), false);
assert.notEqual(first.runner?.lastPageKey, taskB.runner?.lastPageKey);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:tasks; npm run test:page-analysis-recovery`

Expected: FAIL because resume eligibility and durable checkpoints are absent.

- [ ] **Step 3: Implement durable scheduling and guarded resume**

```ts
function resumeAlarmName(taskId: string): string {
  return `baotian:resume:${taskId}`;
}

function canResumeRunner(checkpoint: ApplicationRunnerCheckpoint | undefined): boolean {
  return checkpoint?.status === 'running';
}
```

After every state transition, mirror the auto-run state into `task.runner`. Replace page-transition `setTimeout` calls with `chrome.alarms.create(resumeAlarmName(taskId), { when: Date.now() + delayMs })`. The alarm handler must resolve an open tab through task bindings, confirm the task is still `running`, fetch current page metadata, then call the existing `processAutoRun(tabId)` path. Register both `chrome.tabs.onUpdated` and `chrome.tabs.onActivated` to restore markers/analysis and schedule a resume only for an active `running` checkpoint. Do not resume `paused`, `complete`, `stopped` or archived tasks.

- [ ] **Step 4: Run checkpoint tests and compile to verify they pass**

Run: `npm run test:tasks; npm run test:page-analysis-recovery; npm run compile`

Expected: PASS.

- [ ] **Step 5: Commit the multi-project recovery slice**

```bash
git add entrypoints/background.ts utils/application-tasks.ts scripts/test-application-tasks.ts scripts/test-page-analysis-recovery.ts
git commit -m "feat: resume independent application tasks safely"
```

## Task 7: Release checks and no-submit browser QA

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create: `qa/2026-08-06-repeatable-records-and-task-recovery.md`

**Interfaces:**
- Consumes: user-authenticated Edge tabs for three project URLs supplied in this conversation.
- Produces: evidence of no-submit scans, cached restoration, multi-project isolation and safe pause behavior.

- [ ] **Step 1: Add release documentation and version**

Update README feature bullets with: automatic repeat-row addition; identity-first verification; per-project task recovery; cached scan/AI restoration; and the no-submit safety boundary. Bump `package.json` from `1.3.4` to the chosen patch release version and add the two test scripts if not already present.

- [ ] **Step 2: Run the full automated suite**

Run:

```bash
npm run compile
npm run test:profile
npm run test:local-matcher
npm run test:repeatable-records
npm run test:repeatable-row-request
npm run test:tasks
npm run test:page-analysis-recovery
npm run test:audit
npm run test:ai-queue
npm run test:material-audit
npm run test:audit-view-model
npm run test:page-identity
npm run build
```

Expected: every command exits 0.

- [ ] **Step 3: Perform authenticated browser QA without submission**

Open the three supplied project pages in separate Edge tabs only after the user logs in. For each tab: scan, confirm no final submit control is clicked, record the semantic page key, then return to the page and verify side-panel suggestions/markers restore without an API request. Start safe continuous filling only on a duplicate or cleared test page; verify its own task history/checkpoint changes without changing the other two tabs. Stop before any final submit/confirmation stage. Capture non-sensitive screenshots and write results to the QA note.

- [ ] **Step 4: Verify the release state**

Run:

```bash
git diff --check
git status --short
npm audit --omit=dev --audit-level=high
```

Expected: no whitespace errors, only intentional release files before commit, and no high-severity production dependency vulnerabilities.

- [ ] **Step 5: Commit, tag and push**

```bash
git add package.json README.md qa/2026-08-06-repeatable-records-and-task-recovery.md
git commit -m "feat: release baotian <version>"
git tag v<version>
git push origin main --follow-tags
```

