import assert from 'node:assert/strict';
import { planRepeatableRecords } from '../utils/repeatable-records';
import type { BlockCategory, TextField } from '../utils/db';
import type { FormFieldInfo } from '../utils/matcher';

function field(index: number, overrides: Partial<FormFieldInfo>): FormFieldInfo {
  return {
    index,
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    label: '',
    placeholder: '',
    ariaLabel: '',
    context: '',
    value: '',
    groupLabel: '',
    columnLabel: '',
    repeatGroup: '',
    protected: false,
    protectionReason: '',
    ...overrides,
  } as FormFieldInfo;
}

const textFields: TextField[] = [
  { key: '英语四级成绩', value: '536' },
  { key: '英语六级成绩', value: '489' },
];

const awardBlocks: BlockCategory[] = [{
  title: '本科期间校级以上（含）荣誉奖励',
  sectionId: 'honors_awards',
  items: [{ fields: [
    { key: '获奖名称', value: '程序设计竞赛一等奖' },
    { key: '获奖等级', value: '省级' },
  ] }, { fields: [
    { key: '获奖名称', value: '数学建模二等奖' },
    { key: '获奖等级', value: '校级' },
  ] }],
}];

const reversedLanguageFields = [
  field(0, { groupLabel: '外语水平', rowIndex: 0, columnLabel: '外语考试', value: 'CET-6', options: ['CET-4', 'CET-6'] }),
  field(1, { groupLabel: '外语水平', rowIndex: 0, columnLabel: '考试成绩', value: '489' }),
  field(2, { groupLabel: '外语水平', rowIndex: 1, columnLabel: '外语考试', value: 'CET-4', options: ['CET-4', 'CET-6'] }),
  field(3, { groupLabel: '外语水平', rowIndex: 1, columnLabel: '考试成绩', value: '536' }),
];

const reversedLanguagePlan = planRepeatableRecords(reversedLanguageFields, [], textFields);
assert.deepEqual(
  reversedLanguagePlan.groups['外语水平'].rowBindings,
  [1, 0],
  'existing CET-6/CET-4 rows must bind by the visible exam name, not their ordinal position',
);
assert.equal(reversedLanguagePlan.groups['外语水平'].rowsToAdd, 0);

const emptyAwardPlan = planRepeatableRecords([], awardBlocks, []);
assert.deepEqual(
  emptyAwardPlan.groups['本科期间校级以上（含）荣誉奖励'].missingItemIndexes,
  [0, 1],
  'an empty award table requires rows for every saved award',
);
assert.equal(emptyAwardPlan.groups['本科期间校级以上（含）荣誉奖励'].rowsToAdd, 2);

const existingAwardFields = [
  field(0, { groupLabel: '本科期间校级以上（含）荣誉奖励', rowIndex: 0, columnLabel: '获奖名称', value: '程序设计竞赛一等奖' }),
  field(1, { groupLabel: '本科期间校级以上（含）荣誉奖励', rowIndex: 0, columnLabel: '获奖等级', value: '省级' }),
];
const existingAwardPlan = planRepeatableRecords(existingAwardFields, awardBlocks, []);
assert.deepEqual(existingAwardPlan.groups['本科期间校级以上（含）荣誉奖励'].rowBindings, [0]);
assert.deepEqual(existingAwardPlan.groups['本科期间校级以上（含）荣誉奖励'].missingItemIndexes, [1]);
assert.equal(existingAwardPlan.groups['本科期间校级以上（含）荣誉奖励'].rowsToAdd, 1, 'a populated matching row must not be added again');

const projectedProjectPlan = planRepeatableRecords([
  field(10, { groupLabel: '项目经历', rowIndex: 0, columnLabel: '项目名称', value: 'PRISM-Net' }),
], [{
  title: '科研训练',
  sectionId: 'research_training',
  items: [{ fields: [{ key: '项目名称', value: 'PRISM-Net' }] }],
}], []);
assert.equal(projectedProjectPlan.groups['项目经历']?.rowBindings[0], 0, 'merged project groups should bind a research record');
assert.equal(projectedProjectPlan.groups['项目经历']?.rowsToAdd, 0);

console.log('repeatable records tests passed');
