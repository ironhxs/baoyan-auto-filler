import assert from 'node:assert/strict';

import {
  blockingAgentReviewItems,
  canAgentAdvance,
  deriveAgentFieldStatus,
  deriveAgentRowStatus,
  validateAgentPlan,
} from '../utils/agent/policy';
import type {
  AgentFieldRow,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentTargetField,
} from '../utils/agent/types';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';

function field(targetId: string, label: string, extra: Partial<AgentTargetField> = {}): AgentTargetField {
  return {
    targetId,
    index: Number(targetId.replace(/\D/g, '')) || 0,
    label,
    currentValue: '',
    required: true,
    protected: false,
    kind: 'text',
    options: [],
    placeholder: '',
    formatHints: [],
    forbiddenCharacters: [],
    ...extra,
  };
}

const row: AgentFieldRow = {
  rowIndex: 0,
  fields: [
    field('f1', '时间', { rowIndex: 0, columnId: 'time', formatHints: ['2018-11'] }),
    field('f2', '地点', { rowIndex: 0, columnId: 'place' }),
    field('f3', '内容', { rowIndex: 0, columnId: 'content', forbiddenCharacters: ['|', '#'] }),
  ],
};

const partial = deriveAgentRowStatus(row, { f1: '2026-01' }, {});
assert.equal(partial.status, 'partial');
assert.equal(partial.marker, 'review');
assert.equal(partial.blocksAdvance, true);

const complete = deriveAgentRowStatus(
  row,
  { f1: '2026-01', f2: '华东区域赛', f3: 'OopsOS，操作系统设计赛，三等奖' },
  {},
);
assert.equal(complete.status, 'complete');
assert.equal(complete.marker, 'verified');
assert.equal(complete.blocksAdvance, false);

const languageRow: AgentFieldRow = {
  rowIndex: 0,
  fields: [
    field('language', '外语水平', { rowIndex: 0, columnId: 'language', required: false }),
    field('score', '成绩', { rowIndex: 0, columnId: 'score', required: false }),
    field('date', '取得成绩时间', { rowIndex: 0, columnId: 'date', required: false }),
    field('remark', '备注', { rowIndex: 0, columnId: 'remark', required: false }),
  ],
};
const languageComplete = deriveAgentRowStatus(
  languageRow,
  { language: '大学英语六级', score: '489', date: '2025-06' },
  {},
);
assert.equal(languageComplete.status, 'complete', 'a blank optional remark must not make a completed language row partial');
assert.equal(languageComplete.blocksAdvance, false);

const manual = deriveAgentFieldStatus(
  field('manual', '学习信息'),
  'Agent计划值',
  '用户刚刚修改的值',
  'Agent上次填写的值',
);
assert.equal(manual.status, 'manual');
assert.equal(manual.canOverwrite, false);

const equivalentDate = deriveAgentFieldStatus(
  field('award-date', '获奖时间', { formatHints: ['2018-11'] }),
  '2026-01',
  '2026年1月',
  '',
);
assert.equal(equivalentDate.status, 'verified', 'equivalent webpage date formatting must not be mistaken for a manual conflict');
assert.equal(equivalentDate.canOverwrite, true);

const snapshot: AgentPageSnapshot = {
  pageKey: 'fudan-awards',
  url: 'https://example.test/awards',
  title: '奖励情况',
  stepText: '',
  instructions: ['内容中不得含有 |、#'],
  capturedAt: 1,
  groups: [{
    groupId: 'awards',
    label: '奖励情况',
    kind: 'repeatable',
    columns: [
      { columnId: 'time', label: '时间' },
      { columnId: 'place', label: '地点' },
      { columnId: 'content', label: '内容' },
    ],
    fields: row.fields,
    rows: [row],
  }],
};

const sources: AgentSourceRecord[] = [{
  recordId: 'subject_competitions:0',
  categoryId: 'subject_competitions',
  categoryLabel: '学科竞赛',
  itemIndex: 0,
  fields: { 获奖时间: '2026-01', 获奖等级: '华东区域赛三等奖', 项目: 'Oops|OS#' },
  searchText: '',
}];

const plan: AgentPagePlan = {
  version: 1,
  pageKey: snapshot.pageKey,
  snapshotFingerprint: 's1',
  profileFingerprint: 'p1',
  actions: [{
    actionId: 'row-0',
    type: 'fill_row',
    groupId: 'awards',
    rowIndex: 0,
    sourceRecordId: sources[0].recordId,
    values: [
      { targetId: 'f1', value: '2026年1月', evidenceFields: ['获奖时间'], confidence: 0.99, needsReview: false, reason: '日期转换' },
      { targetId: 'f2', value: '华东区域赛', evidenceFields: ['获奖等级'], confidence: 0.85, needsReview: true, reason: '赛事范围' },
      { targetId: 'f3', value: 'Oops|OS#', evidenceFields: ['项目'], confidence: 0.95, needsReview: false, reason: '项目名称' },
    ],
  }],
  reviewItems: [],
};

const validated = validateAgentPlan(plan, {
  snapshot,
  sourceRecords: sources,
  observedValues: {},
  lastAgentValues: {},
});
assert.equal(validated.executableActions.length, 1);
const executable = validated.executableActions[0];
assert.equal(executable.type, 'fill_row');
if (executable.type !== 'fill_row') throw new Error('expected fill_row');
assert.equal(executable.values[0].value, '2026-01');
assert.equal(executable.values[1].value, '华东地区', 'a place field must receive a natural geographic expression instead of a competition-stage label');
assert.equal(executable.values[2].value, 'OopsOS');

const genericLevelAsPlace = structuredClone(plan);
if (genericLevelAsPlace.actions[0].type === 'fill_row') {
  genericLevelAsPlace.actions[0].values[1].value = '市级';
}
const rejectedGenericPlace = validateAgentPlan(genericLevelAsPlace, {
  snapshot,
  sourceRecords: sources,
  observedValues: {},
  lastAgentValues: {},
});
assert.equal(rejectedGenericPlace.executableActions.length, 0, 'award level text such as 市级 is not a valid place');
assert.equal(rejectedGenericPlace.reviewItems.some((item) => item.targetId === 'f2'), true);

const preserveExistingColumnPlan = structuredClone(plan);
if (preserveExistingColumnPlan.actions[0].type === 'fill_row') {
  preserveExistingColumnPlan.actions[0].values = preserveExistingColumnPlan.actions[0].values
    .filter((value) => value.targetId !== 'f1');
}
const preserveExistingColumn = validateAgentPlan(preserveExistingColumnPlan, {
  snapshot,
  sourceRecords: sources,
  observedValues: { f1: '2026年1月' },
  lastAgentValues: {},
});
assert.equal(
  preserveExistingColumn.executableActions.length,
  1,
  'a row plan may fill the remaining columns when an omitted core column already has a webpage value',
);

const preserveYearOnlyPlan = structuredClone(plan);
if (preserveYearOnlyPlan.actions[0].type === 'fill_row') {
  preserveYearOnlyPlan.actions[0].values[0].value = '2026';
}
const preserveYearOnly = validateAgentPlan(preserveYearOnlyPlan, {
  snapshot,
  sourceRecords: sources,
  observedValues: { f1: '2026年' },
  lastAgentValues: {},
});
assert.equal(preserveYearOnly.executableActions.length, 1, 'an existing year-only date must be preserved while the other evidenced row columns are filled');
assert.equal(preserveYearOnly.rejectedActionIds.length, 0);
const preservedYearAction = preserveYearOnly.executableActions[0];
if (preservedYearAction.type !== 'fill_row') throw new Error('expected preserved fill_row');
assert.deepEqual(preservedYearAction.values.map((value) => value.targetId), ['f2', 'f3']);
assert.equal(preserveYearOnly.reviewItems.some((item) => item.targetId === 'f1'), true);

const languageSnapshot: AgentPageSnapshot = {
  pageKey: 'fudan-language',
  url: 'https://example.test/language',
  title: '外语水平',
  stepText: '',
  instructions: [],
  capturedAt: 1,
  groups: [{
    groupId: 'language',
    label: '外语水平',
    kind: 'repeatable',
    columns: [],
    fields: languageRow.fields,
    rows: [languageRow],
  }],
};
const languageSource: AgentSourceRecord = {
  recordId: 'language:0',
  categoryId: 'language',
  categoryLabel: '外语水平',
  itemIndex: 0,
  fields: { 考试名称: '大学英语六级', 成绩: '489', 考试日期: '2025-06' },
  searchText: '',
};
const languagePlan: AgentPagePlan = {
  version: 1,
  pageKey: languageSnapshot.pageKey,
  snapshotFingerprint: 's-language',
  profileFingerprint: 'p-language',
  actions: [{
    actionId: 'language-row-0',
    type: 'fill_row',
    groupId: 'language',
    rowIndex: 0,
    sourceRecordId: languageSource.recordId,
    values: [
      { targetId: 'language', value: '大学英语六级', evidenceFields: ['考试名称'], confidence: 1, needsReview: false, reason: '考试类型' },
      { targetId: 'score', value: '489', evidenceFields: ['成绩'], confidence: 1, needsReview: false, reason: '成绩' },
      { targetId: 'date', value: '2025-06', evidenceFields: ['考试日期'], confidence: 1, needsReview: false, reason: '考试日期' },
    ],
  }],
  reviewItems: [],
};
const validatedLanguage = validateAgentPlan(languagePlan, {
  snapshot: languageSnapshot,
  sourceRecords: [languageSource],
  observedValues: {},
  lastAgentValues: {},
});
assert.equal(validatedLanguage.executableActions.length, 1, 'an omitted optional remark must not reject the whole row action');
assert.equal(validatedLanguage.reviewItems.length, 0);

const blankOptionalPlan: AgentPagePlan = {
  ...languagePlan,
  actions: [],
  reviewItems: [{
    reviewId: 'no-publications',
    message: '资料明确没有论文，因此不填写该可选表格。',
  }],
};
const blankOptionalSnapshot: AgentPageSnapshot = {
  ...languageSnapshot,
  title: '学术成果',
  groups: languageSnapshot.groups.map((group) => ({
    ...group,
    fields: group.fields.map((item) => ({ ...item, currentValue: '', required: false })),
    rows: group.rows.map((item) => ({
      ...item,
      fields: item.fields.map((fieldItem) => ({ ...fieldItem, currentValue: '', required: false })),
    })),
  })),
};
assert.deepEqual(
  blockingAgentReviewItems(blankOptionalPlan, blankOptionalSnapshot, blankOptionalPlan.reviewItems),
  [],
  'a targetless explanation on a completely blank optional page is advisory and must not halt continuous filling',
);
assert.equal(
  blockingAgentReviewItems(
    blankOptionalPlan,
    blankOptionalSnapshot,
    blankOptionalPlan.reviewItems,
    new Set(),
    new Set(),
    true,
  ).length,
  1,
  'a blank optional page must pause when relevant saved records exist but the model planned no actions',
);
assert.equal(
  blockingAgentReviewItems(
    blankOptionalPlan,
    { ...blankOptionalSnapshot, groups: blankOptionalSnapshot.groups.map((group) => ({
      ...group,
      fields: group.fields.map((item, index) => ({ ...item, required: index === 0 })),
    })) },
    blankOptionalPlan.reviewItems,
  ).length,
  1,
  'the same explanation must remain blocking when the page declares a required field',
);

const filledProtectedSnapshot: AgentPageSnapshot = {
  ...blankOptionalSnapshot,
  title: '获奖情况',
  groups: blankOptionalSnapshot.groups.map((group) => ({
    ...group,
    fields: group.fields.map((item, index) => ({
      ...item,
      currentValue: index === 0 ? '2025年12月' : `网页已有内容${index + 1}`,
      required: index < 2,
      protected: true,
    })),
    rows: [],
  })),
};
const protectedExplanation = [{
  reviewId: 'preserve-protected-awards',
  message: '页面中的字段已有网页值并受保护，因此不规划任何覆盖操作。',
}];
assert.deepEqual(
  blockingAgentReviewItems(blankOptionalPlan, filledProtectedSnapshot, protectedExplanation),
  [],
  'a targetless no-overwrite explanation must not halt a page whose required fields already have protected values',
);

const derivedPlaceReview = [{
  reviewId: 'derived-place',
  actionId: 'row-0',
  targetId: 'f2',
  message: '地点由获奖等级中的赛区信息转换，建议最终审核。',
}];
assert.deepEqual(
  blockingAgentReviewItems(plan, snapshot, derivedPlaceReview, new Set(['row-0'])),
  [],
  'review notes attached to an executable safe action must stay advisory instead of halting the page',
);
assert.equal(
  blockingAgentReviewItems(plan, snapshot, derivedPlaceReview, new Set()).length,
  1,
  'a review note must remain blocking when its referenced action was rejected',
);
assert.deepEqual(
  blockingAgentReviewItems(plan, snapshot, [{
    reviewId: 'model-review-without-action-id',
    targetId: 'f2',
    message: '地点为跨网站语义转换，最终统一复核。',
  }], new Set(['row-0']), new Set(['f1', 'f2', 'f3'])),
  [],
  'a target review for an executable evidenced write must be advisory even when the model omitted actionId',
);
const snapshotWithExistingDate = structuredClone(snapshot);
const existingDateField = snapshotWithExistingDate.groups[0].fields.find((item) => item.targetId === 'f1');
if (!existingDateField) throw new Error('missing existing date fixture');
existingDateField.currentValue = '2026年';
const existingDateRowField = snapshotWithExistingDate.groups[0].rows[0].fields.find((item) => item.targetId === 'f1');
if (!existingDateRowField) throw new Error('missing existing row date fixture');
existingDateRowField.currentValue = '2026年';
assert.deepEqual(
  blockingAgentReviewItems(plan, snapshotWithExistingDate, [{
    reviewId: 'preserved-existing-date',
    targetId: 'f1',
    message: '年份已有，月份需要最终人工核对。',
  }]),
  [],
  'a review note for a preserved non-empty page value must be deferred to final audit instead of blocking the current page',
);

const protectedResult = validateAgentPlan(plan, {
  snapshot,
  sourceRecords: sources,
  observedValues: { f2: '用户人工修正地点' },
  lastAgentValues: { f2: 'Agent旧地点' },
});
assert.equal(protectedResult.executableActions.length, 0, 'a row with a manual value must remain atomic');
assert.deepEqual(protectedResult.manualTargets, ['f2']);

const missingEvidencePlan = structuredClone(plan);
if (missingEvidencePlan.actions[0].type === 'fill_row') {
  missingEvidencePlan.actions[0].values[2].evidenceFields = [];
}
assert.equal(validateAgentPlan(missingEvidencePlan, {
  snapshot,
  sourceRecords: sources,
  observedValues: {},
  lastAgentValues: {},
}).executableActions.length, 0);

const verifiedStatuses = { f1: 'verified', f2: 'manual', f3: 'verified' } as const;
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '最终提交',
  fieldStatuses: verifiedStatuses,
  rowStatuses: [complete],
}), false);
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '确认报名',
  fieldStatuses: verifiedStatuses,
  rowStatuses: [complete],
}), false);
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '选择导师并下一步',
  fieldStatuses: verifiedStatuses,
  rowStatuses: [complete],
}), false);
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '下一步',
  fieldStatuses: { ...verifiedStatuses, f2: 'empty' },
  rowStatuses: [partial],
}), false);
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '下一步',
  fieldStatuses: verifiedStatuses,
  rowStatuses: [complete],
}), true);

console.log('agent policy tests passed');
