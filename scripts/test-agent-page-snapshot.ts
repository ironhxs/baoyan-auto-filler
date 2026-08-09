import assert from 'node:assert/strict';

import { buildAgentPageSnapshot } from '../utils/agent/page-snapshot';
import type { FormFieldInfo } from '../utils/matcher';

function awardField(
  index: number,
  rowIndex: number,
  columnLabel: string,
  extra: Partial<FormFieldInfo> = {},
): FormFieldInfo {
  return {
    index,
    kind: 'text',
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    label: columnLabel,
    hint: columnLabel === '时间' ? '日期格式：2018-11' : '',
    placeholder: '',
    ariaLabel: '',
    context: '奖励情况（本科期间） 内容中不得含有 |、#',
    value: '',
    options: [],
    required: true,
    protected: false,
    repeatGroup: '奖励情况（本科期间）',
    groupLabel: '奖励情况（本科期间）',
    columnLabel,
    rowIndex,
    ...extra,
  } as FormFieldInfo;
}

const fields: FormFieldInfo[] = [
  awardField(0, 0, '时间'),
  awardField(1, 0, '地点'),
  awardField(2, 0, '内容'),
  awardField(3, 1, '时间'),
  awardField(4, 1, '地点'),
  awardField(5, 1, '内容'),
];

const snapshot = buildAgentPageSnapshot({
  pageKey: 'fudan-awards',
  url: 'https://gsas.fudan.edu.cn/tm/example',
  title: '奖励情况（本科期间）',
  stepText: '已完成11步（共13步）',
  instructions: ['日期格式：2018-11', '内容中不得含有 |、#'],
  fields,
  capturedAt: 123,
});

assert.equal(snapshot.groups.length, 1);
assert.equal(snapshot.groups[0].kind, 'repeatable');
assert.equal(snapshot.groups[0].rows.length, 2);
assert.deepEqual(snapshot.groups[0].columns.map((item) => item.label), ['时间', '地点', '内容']);
assert.deepEqual(snapshot.groups[0].rows[0].fields[2].forbiddenCharacters, ['|', '#']);
assert.equal(snapshot.groups[0].rows[0].fields[0].formatHints.includes('2018-11'), true);
assert.notEqual(snapshot.groups[0].rows[0].fields[0].targetId, snapshot.groups[0].rows[1].fields[0].targetId);
assert.equal(snapshot.capturedAt, 123);

const singleSnapshot = buildAgentPageSnapshot({
  pageKey: 'basic',
  url: 'https://example.test/basic',
  title: '基本信息',
  instructions: [],
  fields: [{
    index: 9,
    kind: 'text',
    tag: 'input',
    type: 'text',
    name: 'name',
    id: 'name',
    label: '姓名',
    value: '测试同学',
    required: true,
    protected: true,
    options: ['测试同学'],
    placeholder: '请输入姓名',
    ariaLabel: '姓名',
    context: '基本信息 姓名',
    maxLength: 20,
    forbiddenCharacters: ['#'],
  }],
  capturedAt: 456,
});

assert.equal(singleSnapshot.groups.length, 1);
assert.equal(singleSnapshot.groups[0].kind, 'single');
assert.equal(singleSnapshot.groups[0].fields[0].currentValue, '测试同学');
assert.equal(singleSnapshot.groups[0].fields[0].required, true);
assert.equal(singleSnapshot.groups[0].fields[0].protected, true);
assert.deepEqual(singleSnapshot.groups[0].fields[0].options, ['测试同学']);
assert.equal(singleSnapshot.groups[0].fields[0].placeholder, '请输入姓名');
assert.equal(singleSnapshot.groups[0].fields[0].maxLength, 20);
assert.deepEqual(singleSnapshot.groups[0].fields[0].forbiddenCharacters, ['#']);

console.log('agent page snapshot tests passed');
