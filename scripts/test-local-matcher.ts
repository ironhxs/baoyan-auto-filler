import assert from 'node:assert/strict';
import {
  getAiEligibleFields,
  isMeaningfullyFilled,
  matchFieldsLocally,
  mergeLocalAndAiMatches,
} from '../utils/local-matcher';
import { flattenProfileValues } from '../utils/profile-schema';
import { isPageValueConsistent } from '../utils/value-compare';
import { fieldFingerprint } from '../utils/field-fingerprint';
import type { FormFieldInfo, MatchResult } from '../utils/matcher';
import type { BlockCategory, TextField } from '../utils/db';

function field(index: number, overrides: Partial<FormFieldInfo>): FormFieldInfo {
  return {
    index,
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    label: '',
    hint: '',
    placeholder: '',
    ariaLabel: '',
    title: '',
    value: '',
    options: [],
    required: false,
    groupLabel: '',
    columnLabel: '',
    repeatGroup: '',
    protected: false,
    protectionReason: '',
    ...overrides,
  } as FormFieldInfo;
}

const textFields: TextField[] = [
  { key: '姓名', value: '测试学生' },
  { key: '手机号', value: '13800000000' },
  { key: '英语四级成绩', value: '536' },
  { key: '英语六级成绩', value: '489' },
  { key: '成绩排名', value: '10' },
  { key: '排名基数', value: '151' },
  { key: '通讯地址', value: '测试省测试市测试路1号' },
  { key: '预计毕业年月', value: '2027年6月' },
];
const blocks: BlockCategory[] = [{
  title: '家庭成员',
  sectionId: 'family',
  templateFields: ['姓名', '关系', '工作单位及职务', '联系电话'],
  items: [
    { fields: [
      { key: '姓名', value: '测试父亲' },
      { key: '关系', value: '父亲' },
      { key: '工作单位及职务', value: '某单位职员' },
      { key: '联系电话', value: '13900000001' },
    ] },
    { fields: [
      { key: '姓名', value: '测试母亲' },
      { key: '关系', value: '母亲' },
      { key: '工作单位及职务', value: '某学校教师' },
      { key: '联系电话', value: '13900000002' },
    ] },
  ],
}, {
  title: '奖励情况',
  sectionId: 'awards',
  items: [{ fields: [
    { key: '获奖时间', value: '2025-06' },
    { key: '奖励名称', value: '程序设计竞赛一等奖' },
    { key: '奖励级别', value: '省级' },
  ] }, { fields: [
    { key: '奖励名称', value: '数学建模#二等奖' },
    { key: '奖励级别', value: '校级' },
    { key: '获奖时间', value: '2024-12' },
  ] }],
}];

const fields = [
  field(0, { label: '姓名' }),
  field(1, { groupLabel: '家庭成员', rowIndex: 0, columnLabel: '姓名' }),
  field(2, { groupLabel: '家庭成员', rowIndex: 0, columnLabel: '关系' }),
  field(3, { groupLabel: '家庭成员', rowIndex: 0, columnLabel: '在何单位工作，任何职务' }),
  field(4, { groupLabel: '家庭成员', rowIndex: 0, columnLabel: '联系电话' }),
  field(5, { groupLabel: '家庭成员', rowIndex: 1, columnLabel: '姓名' }),
  field(6, { groupLabel: '家庭成员', rowIndex: 1, columnLabel: '联系电话' }),
  field(7, { label: '导师姓名', protected: true, protectionReason: '导师选择需本人决定' }),
  field(8, { label: '手机号', value: '已有号码' }),
  field(9, { label: '自我介绍' }),
  field(10, { tag: 'select', groupLabel: '外语水平', rowIndex: 0, columnLabel: '外语水平', options: ['CET-4', 'CET-6'] }),
  field(11, { groupLabel: '外语水平', rowIndex: 0, columnLabel: '成绩' }),
  field(12, { tag: 'select', groupLabel: '外语水平', rowIndex: 1, columnLabel: '外语水平', options: ['CET-4', 'CET-6'] }),
  field(13, { groupLabel: '外语水平', rowIndex: 1, columnLabel: '成绩' }),
  field(14, {
    label: '排名总人数*',
    hint: '上一项：成绩排名；当前项为必填字段',
  }),
  field(15, { groupLabel: '外语水平', rowIndex: 0, columnLabel: '取得成绩时间（日期格式：2019-11）' }),
  field(16, { groupLabel: '奖励情况', rowIndex: 0, columnLabel: '获奖等级' }),
  field(17, { groupLabel: '奖励情况', rowIndex: 0, columnLabel: '获奖名称' }),
  field(18, { groupLabel: '奖励情况', rowIndex: 0, columnLabel: '获奖日期' }),
  field(19, {
    tag: 'textarea',
    fillMode: 'long',
    groupLabel: '奖励情况',
    label: '本科期间校级以上荣誉奖励（获奖名称、获奖等级、获奖时间）',
    hint: '内容中不得含有 | #',
  }),
  field(20, {
    label: '固定电话',
    hint: '上一项为通讯地址',
    context: '通讯地址 测试省测试市测试路1号',
  }),
  field(21, { label: '预计毕业年月', value: '202706' }),
  field(22, {
    label: '预计毕业年月',
    value: '',
    dateFormat: 'yyyyMM',
  }),
];

const matches = matchFieldsLocally(fields, textFields, blocks);
const byIndex = new Map(matches.map((match) => [match.index, match]));
const reversed = matchFieldsLocally([
  field(0, { groupLabel: '外语水平', rowIndex: 0, columnLabel: '考试名称', value: 'CET-6' }),
  field(1, { groupLabel: '外语水平', rowIndex: 0, columnLabel: '成绩', value: '489' }),
  field(2, { groupLabel: '外语水平', rowIndex: 1, columnLabel: '考试名称', value: 'CET-4' }),
  field(3, { groupLabel: '外语水平', rowIndex: 1, columnLabel: '成绩', value: '536' }),
], textFields, blocks);
assert.equal(reversed.find((match) => match.index === 1)?.value, '489');
const identityBoundField = field(30, {
  groupLabel: 'repeat-group',
  rowIndex: 0,
  columnLabel: 'date',
});
const identityBoundLocal: MatchResult = {
  kind: 'text',
  index: 30,
  fieldKey: 'repeat-group[1].date',
  value: '2023-12',
  shortLabel: 'date',
  confidence: 'high',
  fillMode: 'short',
  source: 'local',
};
const wrongAiMatch: MatchResult = {
  ...identityBoundLocal,
  fieldKey: 'repeat-group[2].date',
  value: '2025-06',
  source: 'ai',
};
assert.equal(
  mergeLocalAndAiMatches([identityBoundLocal], [wrongAiMatch], [identityBoundField], true)[0]?.value,
  '2023-12',
  'AI must not rebind a repeatable field after row identity is known',
);
const flatLocal = { ...identityBoundLocal, index: 31, fieldKey: 'email', value: 'local', confidence: 'medium' as const };
const flatAi = { ...flatLocal, value: 'ai', confidence: 'high' as const, source: 'ai' as const };
assert.equal(
  mergeLocalAndAiMatches([flatLocal], [flatAi], [field(31, { label: 'email' })], true)[0]?.value,
  'ai',
  'AI enhancement must remain available for non-repeatable ambiguous fields',
);
assert.match(reversed.find((match) => match.index === 1)?.fieldKey ?? '', /外语水平\[2\]/);
assert.equal(byIndex.get(0)?.value, '测试学生');
assert.equal(byIndex.get(1)?.value, '测试父亲');
assert.equal(byIndex.get(2)?.value, '父亲');
assert.equal(byIndex.get(3)?.value, '某单位职员');
assert.equal(byIndex.get(4)?.value, '13900000001');
assert.equal(byIndex.get(5)?.value, '测试母亲');
assert.equal(byIndex.get(6)?.value, '13900000002');
assert.equal(byIndex.has(7), false);
assert.equal(byIndex.get(8)?.value, '13800000000');
assert.equal(byIndex.get(10)?.value, 'CET-4');
assert.equal(byIndex.get(11)?.value, '536');
assert.equal(byIndex.get(12)?.value, 'CET-6');
assert.equal(byIndex.get(13)?.value, '489');
assert.equal(byIndex.get(14)?.value, '151');
assert.equal(byIndex.has(15), false);
assert.equal(byIndex.get(16)?.value, '省级');
assert.equal(byIndex.get(17)?.value, '程序设计竞赛一等奖');
assert.equal(byIndex.get(18)?.value, '2025-06');
assert.equal(byIndex.get(19)?.value, '程序设计竞赛一等奖，省级，2025-06；数学建模二等奖，校级，2024-12');
assert.equal(/[|#]/.test(byIndex.get(19)?.value ?? ''), false);
assert.equal(byIndex.has(20), false);
assert.equal(byIndex.get(21)?.value, '202706');
assert.equal(byIndex.get(22)?.value, '202706');
assert.equal(isPageValueConsistent('138****0000', '13800000000'), true);
assert.equal(isPageValueConsistent('2005-01-08', '20050108'), true);
assert.equal(isPageValueConsistent('202706', '2027年6月'), true);
assert.equal(isPageValueConsistent('156****5006', '15900005006'), false);
assert.equal(isPageValueConsistent('370724 山东省测试县', '山东省测试县', true), true);
assert.equal(
  fieldFingerprint(field(30, { label: '手机号', value: '13800000000' })),
  fieldFingerprint(field(8, { label: '手机号', value: '' })),
);
assert.notEqual(
  fieldFingerprint(field(30, { label: '手机号' })),
  fieldFingerprint(field(30, { label: '家庭住址' })),
);

const aiEligible = getAiEligibleFields(fields, matches);
assert.deepEqual(aiEligible.map((candidate) => candidate.index), [9, 15, 20]);
assert.equal(isMeaningfullyFilled(field(40, { value: '----请选择----', options: ['----请选择----', '汉族'] })), false);

const flattened = flattenProfileValues(textFields, blocks);
assert.equal(flattened.find((value) => value.key === '家庭成员[2].姓名')?.value, '测试母亲');

console.log('local matcher tests passed');
