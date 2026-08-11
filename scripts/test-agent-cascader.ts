import assert from 'node:assert/strict';

import {
  buildCascaderAgentPrompt,
  createCascaderPathCacheEntry,
  createCascaderPathCacheKey,
  parseAndValidateCascaderAgentDecision,
  requestCascaderAgentDecision,
  sanitizeCascaderPageUrl,
  validateCascaderPathCacheEntry,
  type CascaderAgentObservation,
} from '../utils/agent/cascader';

const observation: CascaderAgentObservation = {
  field: {
    label: '就读院校',
    hint: '请先选择学校所在省份，再选择学校',
    controlType: 'cascader',
  },
  target: '合肥工业大学',
  level: 0,
  selectedPath: [],
  visibleOptions: ['北京市', '天津市', '安徽省', '山东省'],
};

const prompt = buildCascaderAgentPrompt(observation);
assert.match(prompt, /就读院校/);
assert.match(prompt, /请先选择学校所在省份/);
assert.match(prompt, /合肥工业大学/);
assert.match(prompt, /安徽省/);
assert.match(prompt, /只能从 visibleOptions/u);
assert.doesNotMatch(prompt, /css selector/i);

assert.deepEqual(
  parseAndValidateCascaderAgentDecision(
    '{"action":"select_visible_option","value":"安徽省","confidence":0.99,"reason":"目标院校位于安徽省"}',
    observation,
  ),
  {
    action: 'select_visible_option',
    value: '安徽省',
    confidence: 0.99,
    reason: '目标院校位于安徽省',
  },
);

assert.equal(
  parseAndValidateCascaderAgentDecision(
    '{"action":"select_visible_option","value":"江苏省","confidence":0.99,"reason":"猜测"}',
    observation,
  ),
  null,
  'Agent must not choose an option outside the current visible allowlist',
);

assert.equal(
  parseAndValidateCascaderAgentDecision(
    '{"action":"click","value":".el-cascader-node:nth-child(3)","confidence":1}',
    observation,
  ),
  null,
  'Agent must not return selectors or arbitrary page actions',
);

assert.equal(
  parseAndValidateCascaderAgentDecision(
    '{"action":"manual_review","value":"","confidence":0.2,"reason":"无法判断"}',
    observation,
  ),
  null,
);

const codedSchoolObservation: CascaderAgentObservation = {
  ...observation,
  level: 1,
  selectedPath: ['安徽省'],
  visibleOptions: ['10357 安徽大学', '10358 中国科学技术大学', '10359 合肥工业大学'],
};
assert.equal(
  parseAndValidateCascaderAgentDecision(
    '{"action":"select_visible_option","value":"合肥工业大学","confidence":0.95,"reason":"末级目标"}',
    codedSchoolObservation,
  )?.value,
  '10359 合肥工业大学',
  'A unique normalized option may resolve to the exact visible page label',
);

const ambiguousCodedObservation: CascaderAgentObservation = {
  ...codedSchoolObservation,
  visibleOptions: ['10359 合肥工业大学', '99999 合肥工业大学'],
};
assert.equal(
  parseAndValidateCascaderAgentDecision(
    '{"action":"select_visible_option","value":"合肥工业大学","confidence":0.95,"reason":"末级目标"}',
    ambiguousCodedObservation,
  ),
  null,
  'Ambiguous normalized candidates must pause instead of guessing',
);

assert.equal(
  sanitizeCascaderPageUrl('https://enroll.example.edu/form?a=secret#route?token=private'),
  'https://enroll.example.edu/form',
  'Cache scope must not retain query or hash secrets',
);

const cacheScope = {
  pageUrl: 'https://enroll.example.edu/form?a=secret#route?token=private',
  fieldIdentity: 'cascader|name=jdyxm|prop=jdyxm|label=就读院校',
  target: '合肥工业大学',
  firstLevelOptions: ['北京市', '安徽省', '山东省'],
};
const key = createCascaderPathCacheKey(cacheScope);
assert.match(key, /^baotian:cascader:path:v1:/);
assert.doesNotMatch(key, /secret|private/);

const entry = createCascaderPathCacheEntry(cacheScope, ['安徽省', '10359 合肥工业大学'], 1_000);
assert.deepEqual(validateCascaderPathCacheEntry(entry, cacheScope, 1_001), [
  '安徽省',
  '10359 合肥工业大学',
]);
assert.equal(validateCascaderPathCacheEntry(entry, {
  ...cacheScope,
  firstLevelOptions: ['北京市', '山东省'],
}, 1_001), null, 'Changed first-level structure must invalidate a cached path');
assert.equal(
  validateCascaderPathCacheEntry({ ...entry, fieldIdentity: 'cascader|input|name=other' }, cacheScope, 1_001),
  null,
  'Cache entry metadata must still reject a hash collision or corrupted field identity',
);
assert.equal(validateCascaderPathCacheEntry(entry, cacheScope, 1_000 + 31 * 24 * 60 * 60 * 1000), null);

const repeatedAdministrativeScope = {
  ...cacheScope,
  target: '北京市海淀区',
  firstLevelOptions: ['北京市', '天津市'],
};
const repeatedAdministrativeEntry = createCascaderPathCacheEntry(
  repeatedAdministrativeScope,
  ['北京市', '北京市', '海淀区'],
  2_000,
);
assert.deepEqual(
  validateCascaderPathCacheEntry(repeatedAdministrativeEntry, repeatedAdministrativeScope, 2_001),
  ['北京市', '北京市', '海淀区'],
  'A valid path may repeat the same administrative label at different levels',
);

let modelRequests = 0;
const requestedDecision = await requestCascaderAgentDecision(observation, async (modelPrompt) => {
  modelRequests++;
  assert.match(modelPrompt, /visibleOptions/u);
  return '{"action":"select_visible_option","value":"安徽省","confidence":0.99,"reason":"目标院校位于安徽省"}';
});
assert.equal(modelRequests, 1);
assert.equal(requestedDecision?.value, '安徽省');

const noOptionDecision = await requestCascaderAgentDecision({ ...observation, visibleOptions: [] }, async () => {
  throw new Error('must not call model without a visible allowlist');
});
assert.equal(noOptionDecision, null);

console.log('Agent cascader tests passed.');
