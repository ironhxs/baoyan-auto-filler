import assert from 'node:assert/strict';
import { projectProfileToTargetSchema, type TargetFieldSchema } from '../utils/profile-projections';
import type { BlockCategory, TextField } from '../utils/db';

const blocks: BlockCategory[] = [
  {
    title: '已发表论文',
    sectionId: 'published_papers',
    items: [{ fields: [
      { key: '作者', value: '测试同学等' },
      { key: '论文标题', value: '缺失模态脑肿瘤分割研究' },
      { key: '刊物/会议名称', value: '医学影像会议' },
      { key: '发表时间', value: '2026年6月' },
    ] }],
  },
  {
    title: '科研训练',
    sectionId: 'research_training',
    items: [{ fields: [
      { key: '起止时间', value: '2025.07-2026.07' },
      { key: '项目名称', value: 'PRISM-Net' },
      { key: '项目级别', value: '科研论文项目' },
      { key: '排名', value: '第一' },
      { key: '项目描述', value: '面向缺失模态脑肿瘤分割' },
    ] }],
  },
  {
    title: '学科竞赛',
    sectionId: 'subject_competitions',
    items: [{ fields: [
      { key: '获奖人', value: '测试同学等（队长）' },
      { key: '获奖项目名称', value: 'OopsOS 内核扩展' },
      { key: '竞赛名称', value: '操作系统设计赛' },
      { key: '获奖等级', value: '华东区域赛三等奖' },
      { key: '获奖时间', value: '2026年1月' },
    ] }],
  },
  {
    title: '本科期间校级以上（含）荣誉奖励',
    sectionId: 'honors_awards',
    items: [{ fields: [
      { key: '获奖名称', value: '一等奖学金' },
      { key: '获奖等级', value: '校级' },
      { key: '获奖时间', value: '2025年12月' },
    ] }],
  },
];

const textFields: TextField[] = [];

const target: TargetFieldSchema = {
  groupLabel: '获奖情况',
  fields: [
    { key: '奖项名称', label: '奖项名称' },
    { key: '奖项级别', label: '奖项级别' },
    { key: '奖项等级', label: '奖项等级' },
    { key: '获奖时间', label: '获奖时间' },
    { key: '竞赛名称', label: '竞赛名称' },
  ],
};

const candidates = projectProfileToTargetSchema(target, blocks, textFields);
const competition = candidates.filter((candidate) => candidate.sourceSectionId === 'subject_competitions');
const honors = candidates.filter((candidate) => candidate.sourceSectionId === 'honors_awards');

assert.equal(competition.find((candidate) => candidate.targetFieldKey === '奖项名称')?.value, 'OopsOS 内核扩展');
assert.equal(competition.find((candidate) => candidate.targetFieldKey === '竞赛名称')?.value, '操作系统设计赛');
assert.equal(competition.find((candidate) => candidate.targetFieldKey === '奖项等级')?.value, '三等奖');
assert.equal(competition.find((candidate) => candidate.targetFieldKey === '奖项级别')?.value, '华东区域赛');
assert.equal(honors.find((candidate) => candidate.targetFieldKey === '奖项名称')?.value, '一等奖学金');
assert.equal(honors.find((candidate) => candidate.targetFieldKey === '奖项级别')?.value, '校级');

const projectCandidates = projectProfileToTargetSchema({
  groupLabel: '项目经历',
  fields: [
    { key: '项目名称', label: '项目名称' },
    { key: '项目描述', label: '项目描述' },
    { key: '项目时间段', label: '项目时间段' },
    { key: '本人角色', label: '本人角色' },
  ],
}, blocks, textFields);
assert.equal(projectCandidates.find((candidate) => candidate.sourceSectionId === 'research_training' && candidate.targetFieldKey === '项目名称')?.value, 'PRISM-Net');
assert.equal(projectCandidates.find((candidate) => candidate.sourceSectionId === 'research_training' && candidate.targetFieldKey === '项目描述')?.value, '面向缺失模态脑肿瘤分割');

const chronologyCandidates = projectProfileToTargetSchema({
  groupLabel: '学习和工作经历（从高中开始填写）',
  fields: [
    { key: '起始时间', label: '起始时间（日期格式：2019-11）' },
    { key: '结束时间', label: '结束时间（日期格式：2019-11）' },
    { key: '学校或工作单位', label: '学校或工作单位' },
    { key: '担任职务', label: '担任职务' },
  ],
}, blocks, textFields);
assert.deepEqual(
  chronologyCandidates,
  [],
  'education/work chronology must stay empty when the profile contains only project, paper, competition, and award records',
);

const explicitChronologyCandidates = projectProfileToTargetSchema({
  groupLabel: '学习和工作经历（从高中开始填写）',
  fields: [
    { key: '起始时间', label: '起始时间（日期格式：2019-11）' },
    { key: '结束时间', label: '结束时间（日期格式：2019-11）' },
    { key: '学校或工作单位', label: '学校或工作单位' },
    { key: '担任职务', label: '担任职务' },
  ],
}, [{
  title: '学习与工作履历',
  sectionId: 'education_career',
  items: [{ fields: [
    { key: '起始时间', value: '2020-09' },
    { key: '结束时间', value: '2023-06' },
    { key: '学校或工作单位', value: '示例中学' },
    { key: '担任职务', value: '学生' },
  ] }],
}], textFields);
assert.deepEqual(
  Object.fromEntries(explicitChronologyCandidates.map((candidate) => [candidate.targetFieldKey, candidate.value])),
  {
    起始时间: '2020-09',
    结束时间: '2023-06',
    学校或工作单位: '示例中学',
    担任职务: '学生',
  },
  'an explicit chronology record must map one-to-one to the four chronology columns',
);

console.log('profile projection tests passed');
