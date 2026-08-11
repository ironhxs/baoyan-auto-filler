import assert from 'node:assert/strict';

import { buildAgentPageSnapshot, stableTargetId } from '../utils/agent/page-snapshot';
import { classifyObservedRepeatTable, extractAgentFieldRules } from '../utils/agent/field-rules';
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
    html: '<section>奖励情况（本科期间）<script>alert("sensitive")</script></section>',
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
  visibleTexts: [
    '复旦大学',
    '计算机科学技术学院',
    '2027年全国优秀大学生夏令营',
  ],
  profileInstitution: '合肥工业大学',
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
assert.equal(snapshot.identity.institutionName, '复旦大学');
assert.equal(snapshot.identity.departmentName, '计算机科学技术学院');
assert.equal(snapshot.questionContext.fullText.includes('内容中不得含有 |、#'), true);
assert.equal(snapshot.groups[0].rows[0].fields[2].questionText.includes('奖励情况'), true);
assert.equal(snapshot.groups[0].rows[0].fields[2].contextHtml.includes('<script'), false);

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

const sysuSnapshot = buildAgentPageSnapshot({
  pageKey: 'sysu-application',
  url: 'https://enroll.sysu.edu.cn/yjszs/plugins/zs/zsxsd/entrance',
  title: '在线报名 - 预推免',
  visibleTexts: ['670 计算机学院', '预推免'],
  profileInstitution: '合肥工业大学',
  instructions: [],
  fields: [],
});
assert.deepEqual(sysuSnapshot.identity, {
  institutionName: '中山大学',
  departmentName: '计算机学院',
  projectName: '预推免',
});

const applicantSourceIdentitySnapshot = buildAgentPageSnapshot({
  pageKey: 'source-identity-must-not-be-target',
  url: 'https://example.test/application/basic',
  title: '基本信息',
  visibleTexts: ['合肥工业大学', '计算机与信息学院', '计算机科学与技术'],
  profileInstitution: '合肥工业大学',
  profileDepartment: '计算机与信息学院',
  profileMajor: '计算机科学与技术',
  instructions: [],
  fields: [{
    index: 20,
    kind: 'text',
    tag: 'input',
    type: 'text',
    name: 'sourceDepartment',
    id: 'sourceDepartment',
    label: '本科院系',
    placeholder: '',
    ariaLabel: '本科院系',
    value: '计算机与信息学院',
    context: '本科就读信息',
  }],
});
assert.deepEqual(applicantSourceIdentitySnapshot.identity, {
  institutionName: '',
  departmentName: '',
  projectName: '',
});

const emptyFamilySnapshot = buildAgentPageSnapshot({
  pageKey: 'sysu-family-empty',
  url: 'https://enroll.sysu.edu.cn/yjszs/plugins/zs/zsxsd/entrance',
  title: '家庭成员',
  stepText: '家庭成员',
  instructions: ['请通过新增按钮逐条填写家庭成员'],
  fields: [],
  repeatGroups: [{
    groupLabel: '家庭成员',
    presentation: 'dialog',
    tableHeaders: ['姓名', '关系', '工作单位及职务', '联系电话'],
    fieldLabels: [],
    currentRowCount: 0,
    hasAddControl: true,
    addControlLabel: '新增',
    dialogVisible: false,
  }],
});
assert.equal(emptyFamilySnapshot.groups.length, 1);
assert.equal(emptyFamilySnapshot.groups[0].kind, 'repeatable');
assert.deepEqual(emptyFamilySnapshot.groups[0].columns.map((column) => column.label), [
  '姓名',
  '关系',
  '工作单位及职务',
  '联系电话',
]);
assert.deepEqual(emptyFamilySnapshot.groups[0].fields, []);
assert.deepEqual(emptyFamilySnapshot.groups[0].rows, []);
assert.deepEqual(emptyFamilySnapshot.groups[0].observation, {
  presentation: 'dialog',
  tableHeaders: ['姓名', '关系', '工作单位及职务', '联系电话'],
  fieldLabels: [],
  currentRowCount: 0,
  hasAddControl: true,
  addControlLabel: '新增',
  dialogVisible: false,
});

const sensitiveSnapshot = buildAgentPageSnapshot({
  pageKey: 'security',
  url: 'https://example.test/basic?access_token=TEST_ONLY_TOKEN&redirect=Authorization%3A%20Bearer%20TEST_ONLY_REDIRECT&view=1',
  title: '基本信息',
  instructions: ['Authorization: Bearer TEST_ONLY_AUTH'],
  fields: [{
    index: 10,
    kind: 'text',
    tag: 'input',
    type: 'password',
    name: 'password',
    id: 'password',
    label: '登录密码',
    placeholder: '请输入密码',
    ariaLabel: '登录密码',
    context: '登录凭证',
    value: 'TEST_ONLY_PASSWORD',
  }, {
    index: 11,
    kind: 'text',
    tag: 'textarea',
    type: 'text',
    name: 'note',
    id: 'note',
    label: '备注',
    placeholder: '请输入备注',
    ariaLabel: '备注',
    context: '补充说明',
    html: '<div data-authorization="Bearer TEST_ONLY_HTML">补充说明</div>',
    value: '普通内容',
  }, {
    index: 12,
    kind: 'text',
    tag: 'input',
    type: 'text',
    name: 'operation',
    id: 'operation',
    label: '操作',
    placeholder: '',
    ariaLabel: '操作',
    context: '付款卡号',
    value: 'TEST_ONLY_PAYMENT',
  }],
});

assert.equal(JSON.stringify(sensitiveSnapshot).includes('TEST_ONLY'), false);
assert.deepEqual(sensitiveSnapshot.groups.flatMap((group) => group.fields).map((field) => field.label), ['备注']);

const stableField = awardField(1, 0, '时间', { id: 'award-time-0' });
assert.equal(
  stableTargetId('fudan-awards', stableField),
  stableTargetId('fudan-awards', { ...stableField, index: 99 }),
  'targetId must survive scan index changes between planning and execution',
);

assert.deepEqual(extractAgentFieldRules({
  texts: ['时间（日期格式：2018-11）', '内容中不得含有 |、#', '最多填写60个字符'],
  domMaxLength: 80,
}), {
  dateFormat: '2018-11',
  formatHints: ['2018-11'],
  forbiddenCharacters: ['|', '#'],
  maxLength: 60,
});

assert.deepEqual(classifyObservedRepeatTable({
  knownGroupLabel: '',
  nearestHeading: '本科期间奖励情况',
  rowEditableCounts: [3, 3, 3],
  columnLabels: ['时间', '地点', '内容'],
  hasAddControl: true,
}), { repeatable: true, groupLabel: '本科期间奖励情况' });
assert.equal(classifyObservedRepeatTable({
  knownGroupLabel: '',
  nearestHeading: '基本信息',
  rowEditableCounts: [1, 1, 1],
  columnLabels: ['字段', '值'],
  hasAddControl: false,
}).repeatable, false);

console.log('agent page snapshot tests passed');
