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

const chronologyPlan = planRepeatableRecords([
  field(20, { groupLabel: '学习和工作经历', rowIndex: 0, columnLabel: '起始时间' }),
  field(21, { groupLabel: '学习和工作经历', rowIndex: 0, columnLabel: '结束时间' }),
  field(22, { groupLabel: '学习和工作经历', rowIndex: 0, columnLabel: '学校或工作单位' }),
  field(23, { groupLabel: '学习和工作经历', rowIndex: 0, columnLabel: '担任职务' }),
], [{
  title: '科研训练',
  sectionId: 'research_training',
  items: [{ fields: [
    { key: '起止时间', value: '2025.07-2026.07' },
    { key: '项目名称', value: 'PRISM-Net' },
    { key: '项目级别', value: '科研论文项目' },
    { key: '排名', value: '第一' },
  ] }],
}, {
  title: '实习实践',
  sectionId: 'internship_practice',
  items: [{ fields: [
    { key: '起止时间', value: '2025年暑期' },
    { key: '实习实践单位', value: '宣砚文化社会实践团队' },
    { key: '主要工作内容', value: '项目调研与成果撰写' },
  ] }],
}, {
  title: '社会工作',
  sectionId: 'social_work',
  items: [{ fields: [
    { key: '起止时间', value: '2024.09-至今' },
    { key: '社会工作名称', value: '班级学习委员' },
    { key: '主要工作内容', value: '学习资料整理' },
  ] }],
}], []);
assert.equal(
  chronologyPlan.groups['学习和工作经历'],
  undefined,
  'education/work chronology must not be synthesized from research, internship, or social-work project records',
);

console.log('repeatable records tests passed');
