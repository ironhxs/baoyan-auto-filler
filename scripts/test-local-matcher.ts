import assert from 'node:assert/strict';
import { getAiEligibleFields, matchFieldsLocally } from '../utils/local-matcher';
import { flattenProfileValues } from '../utils/profile-schema';
import type { FormFieldInfo } from '../utils/matcher';
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
];

const matches = matchFieldsLocally(fields, textFields, blocks);
const byIndex = new Map(matches.map((match) => [match.index, match]));
assert.equal(byIndex.get(0)?.value, '测试学生');
assert.equal(byIndex.get(1)?.value, '测试父亲');
assert.equal(byIndex.get(2)?.value, '父亲');
assert.equal(byIndex.get(3)?.value, '某单位职员');
assert.equal(byIndex.get(4)?.value, '13900000001');
assert.equal(byIndex.get(5)?.value, '测试母亲');
assert.equal(byIndex.get(6)?.value, '13900000002');
assert.equal(byIndex.has(7), false);
assert.equal(byIndex.has(8), false);
assert.equal(byIndex.get(10)?.value, 'CET-4');
assert.equal(byIndex.get(11)?.value, '536');
assert.equal(byIndex.get(12)?.value, 'CET-6');
assert.equal(byIndex.get(13)?.value, '489');
assert.equal(byIndex.get(14)?.value, '151');
assert.equal(byIndex.has(15), false);

const aiEligible = getAiEligibleFields(fields, matches);
assert.deepEqual(aiEligible.map((candidate) => candidate.index), [9]);

const flattened = flattenProfileValues(textFields, blocks);
assert.equal(flattened.find((value) => value.key === '家庭成员[2].姓名')?.value, '测试母亲');

console.log('local matcher tests passed');
