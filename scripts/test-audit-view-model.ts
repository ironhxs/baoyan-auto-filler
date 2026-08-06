import assert from 'node:assert/strict';
import { buildAuditViewModel, buildPopupTaskSummary, groupAuditIssues } from '../utils/audit-view-model';
import type { ApplicationTask } from '../utils/application-tasks';
import type { FinalAuditReport } from '../utils/final-audit';

function task(id: string, name: string, status: ApplicationTask['status'], updatedAt: number): ApplicationTask {
  return {
    id,
    batchId: 'batch-1',
    siteOrigin: `https://${id}.example`,
    siteTitle: name,
    displayName: name,
    initialUrl: `https://${id}.example/app`,
    status,
    pageCount: id === 'current' ? 3 : 2,
    filledCount: id === 'current' ? 20 : 10,
    message: status === 'paused' ? '等待检查' : '已完成',
    history: [],
    pageOrder: [],
    pages: {},
    materials: id === 'current' ? [{
      id: 'material-a',
      fieldFingerprint: 'transcript',
      fieldLabel: '成绩单',
      source: 'metadata',
      filename: '成绩单.pdf',
      status: 'unchecked',
    }] : [],
    createdAt: 100,
    updatedAt,
    lastOpenedAt: updatedAt,
  };
}

const currentTask = task('current', '东南大学', 'paused', 200);
const otherTask = task('other', '示例大学', 'complete', 300);
const model = buildAuditViewModel([otherTask, currentTask], {
  currentTaskId: currentTask.id,
  batchId: currentTask.batchId,
  selectedTaskIds: new Set([otherTask.id, currentTask.id]),
  preflight: {
    taskCount: 2,
    pageCount: 9,
    fieldCount: 80,
    materialCount: 7,
    sampledPageCount: 12,
    notices: [],
  },
  confirmed: false,
});

assert.equal(model.tasks[0].id, currentTask.id);
assert.equal(model.tasks[0].isCurrent, true);
assert.equal(model.tasks[0].selected, true);
assert.equal(model.tasks[0].materialNeedsReview, 1);
assert.equal(model.runDisabled, true);
assert.equal(model.preflightLabel, '2 所学校 · 9 个页面 · 80 个字段 · 7 份材料 · 12 个抽样页');
assert.deepEqual(model.batch, { total: 2, needsReview: 1, selected: 2 });

const popup = buildPopupTaskSummary([otherTask, currentTask], currentTask.id);
assert.equal(popup.current?.id, currentTask.id);
assert.equal(popup.current?.name, '东南大学');
assert.equal(popup.current?.conflictCount, 0);
assert.equal(popup.current?.materialNeedsReview, 1);
assert.deepEqual(popup.batch, { total: 2, needsReview: 1 });

const report: FinalAuditReport = {
  summary: { critical: 1, warning: 1, info: 1 },
  issues: [
    { severity: 'warning', title: '排名需确认', evidence: '两页不一致', recommendation: '人工核对' },
    { severity: 'critical', title: '身份证号冲突', evidence: '值不同', recommendation: '立即核对' },
    { severity: 'info', title: '格式提示', evidence: '日期格式不同', recommendation: '确认格式' },
  ],
  unchecked: [{ title: '扫描件', reason: '模型不支持图像' }],
  confirmed: [{ title: '姓名一致' }],
};
const grouped = groupAuditIssues(report);
assert.equal(grouped.critical[0].severity, 'critical');
assert.equal(grouped.warning[0].severity, 'warning');
assert.equal(grouped.info[0].severity, 'info');
assert.equal(grouped.unchecked[0].reason, '模型不支持图像');
assert.equal(grouped.confirmed[0].title, '姓名一致');

console.log('audit view model tests passed');
