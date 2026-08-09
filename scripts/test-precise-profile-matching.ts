import assert from 'node:assert/strict';
import { matchFieldsLocally } from '../utils/local-matcher';
import type { BlockCategory } from '../utils/db';
import type { FormFieldInfo } from '../utils/matcher';

const field = (index: number, overrides: Partial<FormFieldInfo>): FormFieldInfo => ({
  index, tag: 'input', type: 'text', name: '', id: '', label: '', hint: '',
  placeholder: '', ariaLabel: '', title: '', value: '', options: [], required: false,
  groupLabel: '', columnLabel: '', repeatGroup: '', protected: false, protectionReason: '',
  ...overrides,
} as FormFieldInfo);

const blocks: BlockCategory[] = [{
  title: '学科竞赛',
  sectionId: 'subject_competitions',
  items: [{
    fields: [
      { key: '获奖人', value: '测试同学等（队长）' },
      { key: '获奖项目名称', value: 'OopsOS：基于xv6-RISCV的小型操作系统内核扩展' },
      { key: '竞赛名称', value: '全国大学生计算机系统能力大赛操作系统设计赛' },
      { key: '获奖等级', value: '华东区域赛三等奖' },
      { key: '获奖时间', value: '2026年1月' },
    ],
  }],
}];

const matches = matchFieldsLocally([
  field(0, { groupLabel: '学科竞赛', rowIndex: 0, columnLabel: '竞赛名称' }),
  field(1, { groupLabel: '学科竞赛', rowIndex: 0, columnLabel: '获奖项目名称' }),
  field(2, { groupLabel: '学科竞赛', rowIndex: 0, columnLabel: '获奖等级' }),
  field(3, { groupLabel: '学科竞赛', rowIndex: 0, columnLabel: '获奖时间' }),
  field(4, { groupLabel: '学科竞赛', rowIndex: 0, columnLabel: '获奖人' }),
], [], blocks);
const byIndex = new Map(matches.map((match) => [match.index, match.value]));
assert.equal(byIndex.get(0), '全国大学生计算机系统能力大赛操作系统设计赛');
assert.equal(byIndex.get(1), 'OopsOS：基于xv6-RISCV的小型操作系统内核扩展');
assert.equal(byIndex.get(2), '华东区域赛三等奖');
assert.equal(byIndex.get(3), '2026年1月');
assert.equal(byIndex.get(4), '测试同学等（队长）');

const aggregate = matchFieldsLocally([
  field(5, {
    tag: 'textarea',
    fillMode: 'long',
    groupLabel: '学科竞赛',
    label: '学科竞赛（获奖人、获奖项目名称、竞赛名称、获奖等级、获奖时间）',
  }),
], [], blocks);
assert.equal(aggregate[0]?.value, '测试同学等（队长），OopsOS：基于xv6-RISCV的小型操作系统内核扩展，全国大学生计算机系统能力大赛操作系统设计赛，华东区域赛三等奖，2026年1月');

const projected = matchFieldsLocally([
  field(6, { groupLabel: '项目经历', rowIndex: 0, columnLabel: '项目名称' }),
  field(7, { groupLabel: '项目经历', rowIndex: 0, columnLabel: '项目描述' }),
], [], [{
  title: '科研训练',
  sectionId: 'research_training',
  items: [{ fields: [
    { key: '起止时间', value: '2025.07-2026.07' },
    { key: '项目名称', value: 'PRISM-Net' },
    { key: '项目级别', value: '科研论文项目' },
    { key: '排名', value: '第一' },
    { key: '项目描述', value: '面向缺失模态脑肿瘤分割' },
  ] }],
}]);
assert.equal(projected.find((match) => match.index === 6)?.value, 'PRISM-Net');
assert.equal(projected.find((match) => match.index === 7)?.value, '面向缺失模态脑肿瘤分割');

console.log('precise profile matching tests passed');
