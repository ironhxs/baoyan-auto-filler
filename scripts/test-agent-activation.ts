import assert from 'node:assert/strict';
import { shouldPreferPageAgent } from '../utils/agent/activation';
import type { FormFieldInfo, MatchResult } from '../utils/matcher';

const awardFields = Array.from({ length: 17 }, (_, rowIndex) => [
  { index: rowIndex * 3, label: '时间', columnLabel: '时间', repeatGroup: '奖励情况', rowIndex },
  { index: rowIndex * 3 + 1, label: '地点', columnLabel: '地点', repeatGroup: '奖励情况', rowIndex },
  { index: rowIndex * 3 + 2, label: '内容', columnLabel: '内容', repeatGroup: '奖励情况', rowIndex },
]).flat().map((field) => ({
  kind: 'text', type: 'text', value: '', required: false, protected: false,
  ...field,
} as FormFieldInfo));

assert.equal(shouldPreferPageAgent(awardFields, [], true, true), true);
assert.equal(shouldPreferPageAgent(awardFields, [], false, true), false);
assert.equal(shouldPreferPageAgent(awardFields, [], true, false), false);

const singleFields = [
  { index: 0, kind: 'text', type: 'text', label: '姓名', value: '', protected: false },
  { index: 1, kind: 'text', type: 'text', label: '手机号', value: '', protected: false },
] as FormFieldInfo[];
const localMatches = [
  { index: 0, fieldKey: '姓名', value: '示例', confidence: 'high', source: 'local' },
  { index: 1, fieldKey: '手机号', value: '13800000000', confidence: 'high', source: 'local' },
] as MatchResult[];
assert.equal(shouldPreferPageAgent(singleFields, localMatches, true, true), false);
assert.equal(shouldPreferPageAgent(singleFields, [], true, true), true);

const oneColumnRows = awardFields.filter((field) => field.columnLabel === '时间');
assert.equal(shouldPreferPageAgent(oneColumnRows, [], true, true), true);

console.log('Agent activation tests passed');
