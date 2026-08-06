import assert from 'node:assert/strict';
import {
  bindTaskToTab,
  createApplicationTask,
  selectDefaultAuditTaskIds,
  sortTasksForCurrentSite,
  unbindTaskFromTab,
  updateTaskFromAutoRun,
  upsertTaskPage,
} from '../utils/application-tasks';
import type {
  ApplicationPageSnapshot,
  ApplicationTask,
} from '../utils/application-tasks';

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

assert.equal(task.status, 'stopped');
assert.equal(task.displayName, 'A 大学');
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
