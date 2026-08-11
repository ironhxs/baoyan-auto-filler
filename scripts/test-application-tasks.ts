import assert from 'node:assert/strict';
import {
  bindTaskToTab,
  createApplicationTask,
  getTaskPageAnalysis,
  selectDefaultAuditTaskIds,
  sortTasksForCurrentSite,
  unbindTaskFromTab,
  updateTaskFromAutoRun,
  updateTaskApplicationIdentity,
  updateTaskRunnerCheckpoint,
  canResumeRunner,
  upsertTaskPageAnalysis,
  upsertTaskPage,
} from '../utils/application-tasks';
import type {
  ApplicationPageSnapshot,
  ApplicationTask,
} from '../utils/application-tasks';
import type { ApplicationPageAnalysis, ApplicationRunnerCheckpoint } from '../utils/page-analysis';
import { createAgentBatchBlueprint } from '../utils/agent/batch-prompt';
import { agentFingerprint } from '../utils/agent/planner';
import type { AgentBatchPlan } from '../utils/agent/batch-types';
import type { AgentPageSnapshot } from '../utils/agent/types';

const firstPage: ApplicationPageSnapshot = {
  id: 'page-basic',
  key: 'https://a.example/app/basic',
  label: '基本信息',
  url: 'https://a.example/app/basic',
  signature: 'basic-signature',
  capturedAt: 100,
  fields: [],
  materials: [],
};

const task = createApplicationTask({
  id: 'task-a',
  batchId: 'batch-1',
  siteOrigin: 'https://a.example',
  siteTitle: 'A 大学',
  page: firstPage,
  now: 100,
});

const agentSnapshot: AgentPageSnapshot = {
  pageKey: 'basic-signature',
  url: firstPage.url,
  title: 'A 大学推免报名',
  stepText: '基本信息',
  instructions: ['手机号必须为 11 位'],
  groups: [{
    groupId: 'basic',
    label: '基本信息',
    kind: 'single',
    columns: [],
    rows: [],
    fields: [{
      targetId: 'phone',
      index: 0,
      label: '手机号',
      currentValue: '',
      required: true,
      protected: false,
      kind: 'text',
      options: [],
      placeholder: '',
      formatHints: ['11 位手机号'],
      forbiddenCharacters: [],
    }],
  }],
  capturedAt: 150,
};

const analysisA: ApplicationPageAnalysis = {
  pageKey: firstPage.key,
  pageLabel: firstPage.label,
  pageUrl: firstPage.url,
  pageSignature: firstPage.signature,
  fields: [],
  matches: [],
  markers: [],
  checkedIndexes: [],
  repeatPlan: { groups: {} },
  ai: {
    configured: false,
    mode: 'fallback',
    attempted: false,
    cached: false,
    reviewed: 0,
    error: '',
  },
  agentSnapshot,
  capturedAt: 150,
};
const analysisB: ApplicationPageAnalysis = { ...analysisA, pageKey: 'https://a.example/app/materials', capturedAt: 160 };
const withAnalysis = upsertTaskPageAnalysis(task, analysisA);
assert.equal(getTaskPageAnalysis(withAnalysis, analysisA.pageKey)?.pageKey, analysisA.pageKey);
assert.equal(getTaskPageAnalysis(withAnalysis, analysisB.pageKey), null);
assert.equal(task.pageAnalyses, undefined, 'analysis update must not mutate the input task');
const retrievedAnalysis = getTaskPageAnalysis(withAnalysis, analysisA.pageKey)!;
retrievedAnalysis.agentSnapshot!.groups[0].fields[0].currentValue = 'mutated';
assert.equal(
  getTaskPageAnalysis(withAnalysis, analysisA.pageKey)?.agentSnapshot?.groups[0].fields[0].currentValue,
  '',
  'cached Agent snapshots must be cloned instead of sharing nested field state',
);

const batchBlueprint = createAgentBatchBlueprint('task-a', [{
  snapshot: agentSnapshot,
  sourceRecords: [{
    recordId: 'basic:0',
    categoryId: 'basic',
    categoryLabel: '基本信息',
    itemIndex: 0,
    fields: { 手机号: '13800000000' },
    searchText: '手机号: 13800000000',
  }],
}], 170);
const batchPlan: AgentBatchPlan = {
  version: 1,
  blueprintFingerprint: batchBlueprint.fingerprint,
  pagePlans: [{
    version: 1,
    pageKey: agentSnapshot.pageKey,
    snapshotFingerprint: agentFingerprint(agentSnapshot),
    profileFingerprint: agentFingerprint(batchBlueprint.pages[0].sourceRecords),
    actions: [],
    reviewItems: [],
  }],
  reviewItems: [],
};

const checkpoint: ApplicationRunnerCheckpoint = {
  status: 'running',
  lastPageKey: analysisA.pageKey,
  history: [],
  batchPhase: 'planning',
  batchBlueprint,
  batchPlan,
  updatedAt: 180,
};
const withRunner = updateTaskRunnerCheckpoint(withAnalysis, checkpoint);
assert.equal(withRunner.runner?.status, 'running');
assert.equal(task.runner, undefined, 'immutable update must not mutate the input task');
checkpoint.batchBlueprint!.pages[0].snapshot.title = 'mutated title';
checkpoint.batchPlan!.pagePlans[0].reviewItems.push({ reviewId: 'mutated', message: 'mutated' });
assert.equal(withRunner.runner?.batchBlueprint?.pages[0].snapshot.title, 'A 大学推免报名');
assert.equal(withRunner.runner?.batchPlan?.pagePlans[0].reviewItems.length, 0);

const taskA = createApplicationTask({
  id: 'independent-a',
  batchId: 'batch-a',
  siteOrigin: 'https://a.example',
  siteTitle: 'Project A',
  now: 300,
});
const taskB = createApplicationTask({
  id: 'independent-b',
  batchId: 'batch-b',
  siteOrigin: 'https://b.example',
  siteTitle: 'Project B',
  now: 300,
});
const first = updateTaskRunnerCheckpoint(taskA, {
  ...checkpoint,
  lastPageKey: 'project-a-page',
  status: 'running',
});
const second = updateTaskRunnerCheckpoint(taskB, {
  ...checkpoint,
  lastPageKey: 'project-b-page',
  status: 'paused',
});
assert.equal(canResumeRunner(first.runner), true);
assert.equal(canResumeRunner(second.runner), false);
assert.notEqual(first.runner?.lastPageKey, second.runner?.lastPageKey);

assert.equal(task.status, 'stopped');
assert.equal(task.displayName, 'A 大学');

const identifiedTask = updateTaskApplicationIdentity(task, {
  institutionName: '中山大学',
  departmentName: '计算机学院',
  projectName: '预推免',
}, 175);
assert.equal(identifiedTask.displayName, '中山大学 · 计算机学院 · 预推免');
assert.equal(identifiedTask.siteTitle, '中山大学');
assert.equal(identifiedTask.updatedAt, 175);
assert.equal(task.displayName, 'A 大学', 'identity update must not mutate the input task');
assert.deepEqual(task.pageOrder, ['page-basic']);
assert.equal(task.pages['page-basic'].capturedAt, 100);

const refreshedPage = { ...firstPage, capturedAt: 200, label: '基本资料' };
const updatedPageTask = upsertTaskPage(task, refreshedPage);
assert.deepEqual(updatedPageTask.pageOrder, ['page-basic']);
assert.equal(updatedPageTask.pages['page-basic'].capturedAt, 200);
assert.equal(updatedPageTask.pages['page-basic'].label, '基本资料');
assert.equal(task.pages['page-basic'].capturedAt, 100, 'upsert must not mutate the previous task');

const runningTask = updateTaskFromAutoRun(updatedPageTask, {
  status: 'running',
  pageCount: 1,
  filledCount: 8,
  message: '正在处理学习信息',
  history: [{
    page: 1,
    pageKey: firstPage.key,
    label: '基本信息',
    recognized: 12,
    matched: 10,
    verified: 8,
    conflicts: 1,
    filled: 8,
    aiAttempted: true,
    aiCached: false,
    aiReviewed: 2,
    status: 'checked',
    message: '已核对',
    updatedAt: 220,
  }],
  updatedAt: 220,
});
assert.equal(runningTask.status, 'running');
assert.equal(runningTask.pageCount, 1);
assert.equal(runningTask.filledCount, 8);
assert.equal(runningTask.history[0].conflicts, 1);
assert.equal(runningTask.updatedAt, 220);

const otherTask: ApplicationTask = {
  ...runningTask,
  id: 'task-b',
  siteOrigin: 'https://b.example',
  siteTitle: 'B 大学',
  displayName: 'B 大学',
  status: 'paused',
  updatedAt: 230,
};
const archivedTask: ApplicationTask = {
  ...runningTask,
  id: 'task-c',
  siteOrigin: 'https://c.example',
  siteTitle: 'C 大学',
  displayName: 'C 大学',
  status: 'archived',
  updatedAt: 240,
};
const completeTask: ApplicationTask = {
  ...runningTask,
  id: 'task-a',
  status: 'complete',
  updatedAt: 210,
};

const currentFirst = sortTasksForCurrentSite([otherTask, completeTask, archivedTask], 'task-a');
assert.deepEqual(currentFirst.map((item) => item.id), ['task-a', 'task-c', 'task-b']);

assert.deepEqual(
  selectDefaultAuditTaskIds([completeTask, otherTask, archivedTask], 'batch-1'),
  ['task-b', 'task-a'],
  'paused and complete tasks in the batch are selected newest first; archived tasks are excluded',
);

const bindings = bindTaskToTab({}, 11, 'task-a');
assert.deepEqual(bindings, { '11': 'task-a' });
assert.deepEqual(bindTaskToTab(bindings, 12, 'task-b'), { '11': 'task-a', '12': 'task-b' });
assert.deepEqual(unbindTaskFromTab(bindings, 11), {});
assert.equal(completeTask.id, 'task-a', 'removing a tab binding must not remove the persistent task');

console.log('application task tests passed');
