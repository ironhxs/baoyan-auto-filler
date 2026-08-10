import assert from 'node:assert/strict';

import {
  inferAgentPageIntent,
  retrieveAgentSourceRecords,
} from '../utils/agent/profile-retriever';
import type { AgentPageSnapshot } from '../utils/agent/types';
import type { BlockCategory } from '../utils/db';

function snapshot(
  title: string,
  columns: string[],
  groupLabel = title,
  instructions: string[] = [],
): AgentPageSnapshot {
  return {
    pageKey: title,
    url: 'https://example.test/form',
    title,
    stepText: '',
    instructions,
    capturedAt: 1,
    groups: [{
      groupId: 'group',
      label: groupLabel,
      kind: 'repeatable',
      columns: columns.map((label, index) => ({ columnId: `c${index}`, label })),
      fields: [],
      rows: [],
    }],
  };
}

const blocks: BlockCategory[] = [
  {
    title: '学科竞赛',
    sectionId: 'subject_competitions',
    items: [{ fields: [
      { key: '获奖项目名称', value: 'OopsOS' },
      { key: '竞赛名称', value: '操作系统设计赛' },
      { key: '获奖等级', value: '华东区域赛三等奖' },
      { key: '获奖时间', value: '2026-01' },
    ] }],
  },
  {
    title: '荣誉奖励',
    sectionId: 'honors_awards',
    items: [
      { fields: [
        { key: '获奖名称', value: '一等奖学金' },
        { key: '获奖等级', value: '校级' },
        { key: '获奖时间', value: '2025-12' },
        { key: '空字段', value: '   ' },
      ] },
      { fields: [
        { key: '获奖名称', value: '暑期社会实践“十大典型案例”' },
        { key: '获奖等级', value: '市级' },
        { key: '获奖时间', value: '2025-09' },
      ] },
      { fields: [
        { key: '获奖名称', value: '“大学生看宣城”优秀资政报告' },
        { key: '获奖等级', value: '市级' },
        { key: '获奖时间', value: '2025-09' },
      ] },
    ],
  },
  {
    title: '学习与工作履历',
    sectionId: 'education_career',
    items: [{ fields: [
      { key: '起始时间', value: '2023-09' },
      { key: '结束时间', value: '2027-06' },
      { key: '学校或工作单位', value: '合肥工业大学' },
      { key: '担任职务', value: '学习委员' },
    ] }],
  },
  {
    title: '家庭成员',
    sectionId: 'family_members',
    items: [{ fields: [{ key: '姓名', value: '家长甲' }] }],
  },
  {
    title: '科研训练',
    sectionId: 'research_training',
    items: [{ fields: [
      { key: '项目名称', value: 'PRISM-Net' },
      { key: '项目级别', value: '科研论文项目' },
      { key: '排名', value: '第一' },
    ] }],
  },
  {
    title: '已发表论文',
    sectionId: 'published_papers',
    items: [{ fields: [
      { key: '作者', value: '测试同学等' },
      { key: '论文标题', value: '缺失模态脑肿瘤分割研究' },
      { key: '刊物/会议名称', value: '医学影像会议' },
    ] }],
  },
  {
    title: '已取得专利',
    sectionId: 'granted_patents',
    items: [{ fields: [
      { key: '专利权人', value: '测试同学' },
      { key: '专利名称', value: '多模态分析方法' },
    ] }],
  },
  {
    title: '实习实践',
    sectionId: 'internship_practice',
    items: [{ fields: [
      { key: '实习实践单位', value: '社会实践团队' },
      { key: '主要工作内容', value: '项目获校级一等奖、宣城市十大典型案例、宣城市优秀资政报告' },
    ] }],
  },
  {
    title: '社会工作',
    sectionId: 'social_work',
    items: [{ fields: [{ key: '社会工作名称', value: '班级学习委员' }] }],
  },
];

const awardSnapshot = snapshot(
  '奖励情况（本科期间）',
  ['时间', '地点', '内容'],
  '奖励情况（本科期间）',
  ['何时何地何原因受过何种奖励（内容中不得含有|、#）'],
);
assert.equal(inferAgentPageIntent(awardSnapshot), 'honor');
const awardRecords = retrieveAgentSourceRecords(awardSnapshot, blocks, [
  { key: '学校', value: '合肥工业大学' },
]);
assert.deepEqual([...new Set(awardRecords.map((record) => record.categoryId))], [
  'honors_awards',
], 'the narrative honors question must not receive subject-competition records');
assert.equal(awardRecords[0].recordId, 'honors_awards:0');
assert.equal('空字段' in awardRecords[0].fields, false);
assert.equal(awardRecords[0].fields.地点语义证据, '合肥工业大学');
assert.equal('网页内容候选' in awardRecords[0].fields, false);
assert.equal(awardRecords[1].fields.地点语义证据, '宣城市', 'a generic 市级 must be resolved from a related factual record, not written as the place');
assert.equal(awardRecords[2].fields.地点语义证据, '宣城市', 'related evidence can resolve a location through a distinctive award type, not only an exact full title');

const academicSnapshot = snapshot(
  '学术成果',
  [],
  '学术成果（包括荣获奖项、发表论文、学术活动等）',
  ['内容中不得含有|、#'],
);
academicSnapshot.groups[0].kind = 'single';
academicSnapshot.groups[0].fields = [{
  targetId: 'academic-summary',
  index: 0,
  label: '学术成果（包括荣获奖项、发表论文、学术活动等）',
  currentValue: '',
  required: false,
  protected: false,
  kind: 'text',
  options: [],
  placeholder: '',
  formatHints: [],
  forbiddenCharacters: ['|', '#'],
}];
assert.equal(
  inferAgentPageIntent(academicSnapshot),
  'academic_achievement',
  'the page title must win over nested words such as 发表论文 and 荣获奖项',
);
const academicRecords = retrieveAgentSourceRecords(academicSnapshot, blocks, []);
assert.deepEqual(academicRecords.map((record) => record.recordId), ['academic_achievement:aggregate']);
const academicAggregate = academicRecords.find((record) => record.recordId === 'academic_achievement:aggregate');
assert.ok(academicAggregate, 'a single academic-achievement field needs one auditable multi-record source for synthesis');
assert.equal(academicAggregate.fields['科研训练[1].项目名称'], 'PRISM-Net');
assert.equal(academicAggregate.fields['学科竞赛[1].竞赛名称'], '操作系统设计赛');
assert.equal(academicAggregate.fields['已发表论文[1].论文标题'], '缺失模态脑肿瘤分割研究');
assert.equal(academicAggregate.fields['已取得专利[1].专利名称'], '多模态分析方法');
assert.equal(
  Object.keys(academicAggregate.fields).some((key) => key.startsWith('荣誉奖励[')),
  false,
  'general honors belong to the dedicated honors question, not the academic-achievement summary',
);

const competitionSnapshot = snapshot('学科竞赛', ['竞赛名称', '获奖等级', '获奖时间']);
assert.equal(inferAgentPageIntent(competitionSnapshot), 'competition');
assert.deepEqual(
  [...new Set(retrieveAgentSourceRecords(competitionSnapshot, blocks, []).map((record) => record.categoryId))],
  ['subject_competitions'],
);

const careerSnapshot = snapshot(
  '学习和工作经历',
  ['起始时间', '结束时间', '学校或工作单位', '担任职务'],
);
assert.equal(inferAgentPageIntent(careerSnapshot), 'education_career');
assert.deepEqual(
  retrieveAgentSourceRecords(careerSnapshot, blocks, []).map((record) => record.categoryId),
  ['education_career'],
);

const projectSnapshot = snapshot(
  '项目经历',
  ['项目名称', '项目描述', '项目时间段', '本人角色'],
);
assert.equal(inferAgentPageIntent(projectSnapshot), 'project');
assert.deepEqual(
  [...new Set(retrieveAgentSourceRecords(projectSnapshot, blocks, []).map((record) => record.categoryId))],
  ['research_training', 'internship_practice', 'social_work'],
);

const aggregateProjectSnapshot = snapshot('个人陈述', [], '科研、实践及项目经历');
aggregateProjectSnapshot.groups[0].kind = 'aggregate';
assert.equal(inferAgentPageIntent(aggregateProjectSnapshot), 'project');

console.log('agent profile retriever tests passed');
