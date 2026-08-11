import assert from 'node:assert/strict';
import { getOptionalSectionFieldKeys, getSectionDefinition, getSectionFieldKeys, PROFILE_SECTIONS, DEFAULT_REPEAT_SECTIONS } from '../utils/profile-schema';

const repeatIds = DEFAULT_REPEAT_SECTIONS.map((section) => section.id);
assert.deepEqual(repeatIds, [
  'family',
  'language',
  'education_career',
  'research_training',
  'internship_practice',
  'social_work',
  'published_papers',
  'granted_patents',
  'subject_competitions',
  'honors_awards',
]);

assert.deepEqual(getSectionFieldKeys('subject_competitions'), [
  '获奖人', '获奖项目名称', '竞赛名称', '获奖等级', '获奖时间',
]);
assert.deepEqual(getOptionalSectionFieldKeys('published_papers'), [
  '论文类型', '发表状态', '分区', '本人排名',
]);
assert.equal(getSectionDefinition('experience'), undefined);
assert.equal(getSectionDefinition('academic'), undefined);
assert.equal(getSectionDefinition('awards'), undefined);
assert.equal(PROFILE_SECTIONS.filter((section) => section.id === 'honors_awards').length, 1);

console.log('profile-schema tests passed');
