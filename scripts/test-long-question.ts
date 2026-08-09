import assert from 'node:assert/strict';
import {
  buildLongQuestionPrompt,
  chunkLongQuestionContext,
  createLongQuestionCacheKey,
  mergeLongQuestionDrafts,
  type LongQuestionDraft,
  type LongQuestionRequest,
} from '../utils/long-question';

const longText = [
  '科研训练：2025.07-2026.07，PRISM-Net，科研论文项目，排名第一。',
  '社会工作：2024.09-至今，班级学习委员，负责课程信息传达和学习资料整理。',
  '竞赛：2026年1月，OopsOS，华东区域赛三等奖。',
].join('\n\n');

const chunks = chunkLongQuestionContext(longText, 70);
assert.equal(chunks.length, 3, 'paragraph boundaries should be preserved when possible');
assert.ok(chunks.every((chunk) => chunk.length <= 70));
assert.ok(chunks[0].includes('2025.07-2026.07'));

const request: LongQuestionRequest = {
  question: '请简述科研训练经历及个人贡献',
  targetField: '项目描述',
  pageContext: '项目经历表单，要求 500 字以内',
  relevantRecords: [{
    sectionId: 'research_training',
    itemIndex: 0,
    fields: {
      '起止时间': '2025.07-2026.07',
      '项目名称': 'PRISM-Net',
      '排名': '第一',
    },
  }],
  mode: 'fast',
  maxInputChars: 2000,
  maxOutputChars: 500,
};
const prompt = buildLongQuestionPrompt(request, chunks[0]);
assert.match(prompt, /fast|快速/i);
assert.match(prompt, /2025\.07-2026\.07/);
assert.match(prompt, /只能依据|不得编造/);

const drafts: LongQuestionDraft[] = [
  { text: '我参与 PRISM-Net 项目。', sourceRefs: [{ sectionId: 'research_training', itemIndex: 0, fieldKeys: ['项目名称'] }], missingFacts: [], needsReview: true },
  { text: '项目中我排名第一。', sourceRefs: [{ sectionId: 'research_training', itemIndex: 0, fieldKeys: ['排名'] }], missingFacts: ['具体技术贡献'], needsReview: true },
];
const merged = mergeLongQuestionDrafts(drafts, 100);
assert.equal(merged.needsReview, true);
assert.equal(merged.text, '我参与 PRISM-Net 项目。\n项目中我排名第一。');
assert.deepEqual(merged.missingFacts, ['具体技术贡献']);
assert.equal(createLongQuestionCacheKey(request, 'profile-v2'), createLongQuestionCacheKey({ ...request }, 'profile-v2'));
assert.notEqual(createLongQuestionCacheKey(request, 'profile-v1'), createLongQuestionCacheKey(request, 'profile-v2'));

console.log('long question tests passed');
