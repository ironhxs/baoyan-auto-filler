import assert from 'node:assert/strict';
import { appendProfileBlocks, parseProfileImportBundle } from '../utils/profile-data';

const bundle = parseProfileImportBundle(JSON.stringify({
  schema: 'auto-filler.profile',
  version: 2,
  blocks: [
    {
      title: '学科竞赛',
      sectionId: 'subject_competitions',
      items: [{
        fields: [
          { key: '获奖人', value: '贺鑫帅等（队长）' },
          { key: '获奖项目名称', value: 'OopsOS：基于xv6-RISCV的小型操作系统内核扩展' },
          { key: '竞赛名称', value: '全国大学生计算机系统能力大赛操作系统设计赛' },
          { key: '奖项等级', value: '华东区域赛三等奖' },
          { key: '获奖时间', value: '2026年1月' },
          { key: '错误字段', value: '不应被合并' },
        ],
      }],
    },
    {
      title: '已发表论文',
      sectionId: 'published_papers',
      items: [{ fields: [{ key: '论文标题', value: '无' }] }],
    },
    {
      title: '已取得专利',
      sectionId: 'granted_patents',
      items: [{ fields: [{ key: '专利名称', value: '无' }] }],
    },
  ],
}));

const competition = bundle.blocks.find((block) => block.sectionId === 'subject_competitions')!;
assert.equal(competition.items.length, 1);
const fields = Object.fromEntries(competition.items[0].fields.map((field) => [field.key, field.value]));
assert.equal(fields['获奖项目名称'], 'OopsOS：基于xv6-RISCV的小型操作系统内核扩展');
assert.equal(fields['竞赛名称'], '全国大学生计算机系统能力大赛操作系统设计赛');
assert.equal(fields['获奖等级'], '华东区域赛三等奖');
assert.ok(bundle.warnings?.some((warning) => warning.kind === 'unknown-field' && warning.fieldKey === '错误字段'));
assert.equal(bundle.blocks.find((block) => block.sectionId === 'published_papers')?.items.length, 0);
assert.equal(bundle.blocks.find((block) => block.sectionId === 'granted_patents')?.items.length, 0);

const appended = appendProfileBlocks(
  [{ id: 1, title: '荣誉', sectionId: 'honors_awards', items: [] }],
  [
    { title: '竞赛', sectionId: 'subject_competitions', items: [{ fields: [{ key: '竞赛名称', value: 'A' }] }] },
    { title: '荣誉', sectionId: 'honors_awards', items: [{ fields: [{ key: '获奖名称', value: 'B' }] }] },
  ],
);
assert.equal(appended.find((block) => block.sectionId === 'subject_competitions')?.items.length, 1);
assert.equal(appended.find((block) => block.sectionId === 'honors_awards')?.items.length, 1);

console.log('precise profile import tests passed');

