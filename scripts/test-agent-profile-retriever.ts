import assert from 'node:assert/strict';

import {
  inferAgentPageIntent,
  retrieveAgentSourceRecords,
} from '../utils/agent/profile-retriever';
import type { AgentPageSnapshot } from '../utils/agent/types';
import type { BlockCategory } from '../utils/db';

function snapshot(title: string, columns: string[], groupLabel = title): AgentPageSnapshot {
  return {
    pageKey: title,
    url: 'https://example.test/form',
    title,
    stepText: '',
    instructions: [],
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
    items: [{ fields: [
      { key: '获奖名称', value: '一等奖学金' },
      { key: '获奖等级', value: '校级' },
      { key: '获奖时间', value: '2025-12' },
      { key: '空字段', value: '   ' },
    ] }],
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
    title: '实习实践',
    sectionId: 'internship_practice',
    items: [{ fields: [{ key: '实习实践单位', value: '社会实践团队' }] }],
  },
  {
    title: '社会工作',
    sectionId: 'social_work',
    items: [{ fields: [{ key: '社会工作名称', value: '班级学习委员' }] }],
  },
];

const awardSnapshot = snapshot('奖励情况（本科期间）', ['时间', '地点', '内容']);
assert.equal(inferAgentPageIntent(awardSnapshot), 'award');
const awardRecords = retrieveAgentSourceRecords(awardSnapshot, blocks, []);
assert.deepEqual([...new Set(awardRecords.map((record) => record.categoryId))], [
  'subject_competitions',
  'honors_awards',
]);
assert.equal(awardRecords[0].recordId, 'subject_competitions:0');
assert.equal('空字段' in awardRecords[1].fields, false);

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
