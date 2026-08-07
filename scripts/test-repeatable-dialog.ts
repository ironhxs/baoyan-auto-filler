import assert from 'node:assert/strict';
import {
  classifyRepeatDialogFields,
  classifyRepeatDialogSaveControl,
  isProtectedRepeatDialogControl,
  planRepeatDialogAssignments,
} from '../utils/repeatable-dialog';

const fields = classifyRepeatDialogFields([
  { index: 0, label: '\u83b7\u5956\u65f6\u95f4', value: '', required: true, kind: 'text', protected: false },
  { index: 1, label: '\u83b7\u5956\u540d\u79f0', value: '', required: true, kind: 'text', protected: false },
  { index: 2, label: '\u83b7\u5956\u7b49\u7ea7', value: '', required: false, kind: 'text', protected: false },
]);
assert.deepEqual(fields.map((field) => field.semanticKey), ['date', 'name', 'level']);
assert.equal(fields.every((field) => !field.ambiguous), true);

const reorderedFamilyFields = classifyRepeatDialogFields([
  { index: 0, label: '\u8054\u7cfb\u7535\u8bdd', value: '', required: true, kind: 'text', protected: false },
  { index: 1, label: '\u5173\u7cfb', value: '', required: true, kind: 'text', protected: false },
  { index: 2, label: '\u59d3\u540d', value: '', required: true, kind: 'text', protected: false },
  { index: 3, label: '\u5728\u4f55\u5355\u4f4d\u5de5\u4f5c\uff0c\u4efb\u4f55\u804c\u52a1', value: '', required: false, kind: 'text', protected: false },
]);
assert.deepEqual(reorderedFamilyFields.map((field) => field.semanticKey), ['phone', 'relation', 'name', 'organization']);

const reorderedPaperFields = classifyRepeatDialogFields([
  { index: 0, label: '\u4f5c\u8005\u6392\u540d', value: '', required: false, kind: 'text', protected: false },
  { index: 1, label: '\u53d1\u8868\u72b6\u6001', value: '', required: false, kind: 'text', protected: false },
  { index: 2, label: '\u8bba\u6587\u7c7b\u578b', value: '', required: true, kind: 'text', protected: false },
  { index: 3, label: '\u53d1\u8868\u65e5\u671f', value: '', required: true, kind: 'text', protected: false },
  { index: 4, label: '\u8bba\u6587\u540d\u79f0', value: '', required: true, kind: 'text', protected: false },
]);
assert.deepEqual(reorderedPaperFields.map((field) => field.semanticKey), ['ranking', 'status', 'type', 'date', 'name']);

const duplicateNames = classifyRepeatDialogFields([
  { index: 0, label: '\u8bba\u6587\u540d\u79f0', value: '', required: true, kind: 'text', protected: false },
  { index: 1, label: '\u6210\u679c\u540d\u79f0', value: '', required: true, kind: 'text', protected: false },
]);
assert.equal(duplicateNames.every((field) => field.ambiguous), true, 'duplicate semantic fields must pause instead of guessing');

assert.equal(classifyRepeatDialogSaveControl('\u4fdd\u5b58').safe, true);
assert.equal(classifyRepeatDialogSaveControl('\u786e\u5b9a').safe, true);
assert.equal(classifyRepeatDialogSaveControl('\u4fdd\u5b58\u5e76\u5173\u95ed').safe, true);
assert.equal(classifyRepeatDialogSaveControl('\u63d0\u4ea4\u62a5\u540d').safe, false);
assert.equal(classifyRepeatDialogSaveControl('\u786e\u8ba4\u62a5\u540d').safe, false);
assert.equal(classifyRepeatDialogSaveControl('\u4e0b\u4e00\u6b65').safe, false);
assert.equal(isProtectedRepeatDialogControl('\u9009\u62e9\u5bfc\u5e08'), true);
assert.equal(isProtectedRepeatDialogControl('\u8f93\u5165\u9a8c\u8bc1\u7801'), true);
assert.equal(isProtectedRepeatDialogControl('\u4fdd\u5b58'), false);

const familyPlan = planRepeatDialogAssignments(reorderedFamilyFields, [
  { key: '\u59d3\u540d', value: 'Family member' },
  { key: '\u5173\u7cfb', value: 'Parent' },
  { key: '\u5728\u4f55\u5355\u4f4d\u5de5\u4f5c\uff0c\u4efb\u4f55\u804c\u52a1', value: 'Organization and role' },
  { key: '\u8054\u7cfb\u7535\u8bdd', value: '10000000000' },
]);
assert.deepEqual(familyPlan.assignments.map(({ index, value }) => ({ index, value })), [
  { index: 0, value: '10000000000' },
  { index: 1, value: 'Parent' },
  { index: 2, value: 'Family member' },
  { index: 3, value: 'Organization and role' },
]);
assert.deepEqual(familyPlan.failures, []);

const aggregatePlan = planRepeatDialogAssignments(classifyRepeatDialogFields([
  { index: 4, label: '\u8bba\u6587\u60c5\u51b5', value: '', required: true, kind: 'text', protected: false },
]), [
  { key: '\u8bba\u6587\u540d\u79f0', value: 'Paper title' },
  { key: '\u53d1\u8868\u65f6\u95f4', value: '2026-01' },
  { key: '\u4f5c\u8005\u6392\u540d', value: '1/3' },
]);
assert.equal(aggregatePlan.assignments.length, 1);
assert.equal(aggregatePlan.assignments[0].index, 4);
assert.match(aggregatePlan.assignments[0].value, /Paper title/);
assert.match(aggregatePlan.assignments[0].value, /2026-01/);
assert.match(aggregatePlan.assignments[0].value, /1\/3/);
assert.deepEqual(aggregatePlan.failures, []);

const ambiguousPlan = planRepeatDialogAssignments(duplicateNames, [
  { key: '\u8bba\u6587\u540d\u79f0', value: 'Paper title' },
]);
assert.equal(ambiguousPlan.assignments.length, 0);
assert.equal(ambiguousPlan.failures.some((failure) => failure.code === 'ambiguous-required-field'), true);

const protectedPlan = planRepeatDialogAssignments(classifyRepeatDialogFields([
  { index: 9, label: '\u9009\u62e9\u5bfc\u5e08', value: '', required: true, kind: 'text', protected: true },
]), [{ key: '\u5bfc\u5e08', value: 'Do not fill' }]);
assert.equal(protectedPlan.assignments.length, 0);
assert.equal(protectedPlan.failures.some((failure) => failure.code === 'protected-required-field'), true);

console.log('repeatable dialog tests passed');
