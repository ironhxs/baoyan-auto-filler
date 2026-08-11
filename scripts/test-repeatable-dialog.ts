import assert from 'node:assert/strict';
import {
  classifyRepeatDialogFields,
  classifyRepeatDialogSaveControl,
  hasVerifiedRepeatRecordChange,
  isProtectedRepeatDialogControl,
  planRepeatDialogAssignments,
  pickRepeatDialogFieldLabel,
  selectRepeatDialogRoot,
  selectRepeatDialogSaveCandidate,
  validateRepeatDialogCommit,
} from '../utils/repeatable-dialog';

const repeatDialogModule = await import('../utils/repeatable-dialog');
assert.equal(
  typeof repeatDialogModule.selectRepeatDialogCancelCandidate,
  'function',
  'a failed record must have a narrowly scoped cancel selector before another group can continue',
);
const selectRepeatDialogCancelCandidate = repeatDialogModule.selectRepeatDialogCancelCandidate as <T>(
  candidates: Array<{ id: T; label: string; recordAssociated: boolean }>,
) => { id?: T; reason: 'record-cancel' | 'ambiguous-record-cancel' | 'no-record-cancel' };
assert.deepEqual(selectRepeatDialogCancelCandidate([
  { id: 'record-cancel', label: '\u53d6\u6d88', recordAssociated: true },
  { id: 'page-submit', label: '\u63d0\u4ea4\u62a5\u540d', recordAssociated: false },
]), { id: 'record-cancel', reason: 'record-cancel' });
assert.deepEqual(selectRepeatDialogCancelCandidate([
  { id: 'first', label: '\u53d6\u6d88', recordAssociated: true },
  { id: 'second', label: '\u53d6\u6d88', recordAssociated: true },
]), { id: undefined, reason: 'ambiguous-record-cancel' });
assert.deepEqual(selectRepeatDialogCancelCandidate([
  { id: 'close-page', label: '\u5173\u95ed\u9875\u9762', recordAssociated: false },
]), { id: undefined, reason: 'no-record-cancel' });

assert.equal(pickRepeatDialogFieldLabel({
  columnLabel: '',
  label: '\u5956\u9879\u7ea7\u522b',
  hint: '*',
  context: '*\u5956\u9879\u7ea7\u522b',
}), '\u5956\u9879\u7ea7\u522b', 'the primary field label must not be polluted by validation hints or context');

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

const sysuProjectFields = classifyRepeatDialogFields([
  { index: 0, label: '\u9879\u76ee\u540d\u79f0', value: '', required: true, kind: 'text', protected: false },
  { index: 1, label: '\u9879\u76ee\u63cf\u8ff0', value: '', required: true, kind: 'text', protected: false },
  { index: 2, label: '\u9879\u76ee\u65f6\u95f4\u6bb5', value: '', required: true, kind: 'text', protected: false },
  { index: 3, label: '\u672c\u4eba\u89d2\u8272', value: '', required: true, kind: 'text', protected: false },
]);
assert.deepEqual(sysuProjectFields.map((field) => field.semanticKey), ['name', 'description', 'date', 'role']);
assert.equal(sysuProjectFields.every((field) => !field.ambiguous), true, '本人角色 must be a first-class role field');
assert.deepEqual(planRepeatDialogAssignments(sysuProjectFields, [
  { key: '\u9879\u76ee\u540d\u79f0', value: 'PRISM-Net' },
  { key: '\u9879\u76ee\u63cf\u8ff0', value: '缺失模态脑肿瘤分割研究' },
  { key: '\u9879\u76ee\u65f6\u95f4\u6bb5', value: '2025.07-2026.07' },
  { key: '\u672c\u4eba\u89d2\u8272', value: '排名第一' },
]).failures, []);

const sysuAwardFields = classifyRepeatDialogFields([
  { index: 0, label: '\u5956\u9879\u540d\u79f0', value: '', required: true, kind: 'text', protected: false },
  { index: 1, label: '\u5956\u9879\u7ea7\u522b', value: '', required: true, kind: 'text', protected: false },
  { index: 2, label: '\u5956\u9879\u7b49\u7ea7', value: '', required: true, kind: 'text', protected: false },
  { index: 3, label: '\u83b7\u5956\u65f6\u95f4', value: '', required: true, kind: 'text', protected: false },
  { index: 4, label: '\u4e3b\u529e\u5355\u4f4d', value: '', required: true, kind: 'text', protected: false },
  { index: 5, label: '\u63cf\u8ff0', value: '', required: true, kind: 'text', protected: false },
  { index: 6, label: '\u672c\u4eba\u6392\u540d', value: '', required: true, kind: 'text', protected: false },
]);
assert.deepEqual(sysuAwardFields.map((field) => field.semanticKey), [
  'name', 'level', 'level', 'date', 'organization', 'description', 'ranking',
]);
const sysuAwardPlan = planRepeatDialogAssignments(sysuAwardFields, [
  { key: '\u5956\u9879\u540d\u79f0', value: 'OopsOS' },
  { key: '\u5956\u9879\u7ea7\u522b', value: '\u534e\u4e1c\u533a\u57df\u8d5b' },
  { key: '\u5956\u9879\u7b49\u7ea7', value: '\u4e09\u7b49\u5956' },
  { key: '\u83b7\u5956\u65f6\u95f4', value: '2026-01' },
  { key: '\u4e3b\u529e\u5355\u4f4d', value: '\u5927\u8d5b\u7ec4\u59d4\u4f1a' },
  { key: '\u63cf\u8ff0', value: '\u64cd\u4f5c\u7cfb\u7edf\u5185\u6838\u6269\u5c55' },
  { key: '\u672c\u4eba\u6392\u540d', value: '1' },
]);
assert.deepEqual(sysuAwardPlan.failures, [], 'distinct exact labels must override duplicate semantic categories');
assert.deepEqual(sysuAwardPlan.assignments.map(({ index, sourceKey }) => ({ index, sourceKey })), [
  { index: 0, sourceKey: '\u5956\u9879\u540d\u79f0' },
  { index: 1, sourceKey: '\u5956\u9879\u7ea7\u522b' },
  { index: 2, sourceKey: '\u5956\u9879\u7b49\u7ea7' },
  { index: 3, sourceKey: '\u83b7\u5956\u65f6\u95f4' },
  { index: 4, sourceKey: '\u4e3b\u529e\u5355\u4f4d' },
  { index: 5, sourceKey: '\u63cf\u8ff0' },
  { index: 6, sourceKey: '\u672c\u4eba\u6392\u540d' },
]);

const duplicateNames = classifyRepeatDialogFields([
  { index: 0, label: '\u8bba\u6587\u540d\u79f0', value: '', required: true, kind: 'text', protected: false },
  { index: 1, label: '\u6210\u679c\u540d\u79f0', value: '', required: true, kind: 'text', protected: false },
]);
assert.equal(duplicateNames.every((field) => field.ambiguous), true, 'duplicate semantic fields must pause instead of guessing');

assert.equal(classifyRepeatDialogSaveControl('\u4fdd\u5b58').safe, true);
assert.equal(classifyRepeatDialogSaveControl('\u786e\u5b9a').safe, true);
assert.equal(classifyRepeatDialogSaveControl('\u4fdd\u5b58\u5e76\u5173\u95ed').safe, true);
assert.equal(classifyRepeatDialogSaveControl('Save').safe, true);
assert.equal(classifyRepeatDialogSaveControl('Save and Close').safe, true);
assert.equal(classifyRepeatDialogSaveControl('\u63d0\u4ea4\u62a5\u540d').safe, false);
assert.equal(classifyRepeatDialogSaveControl('\u786e\u8ba4\u62a5\u540d').safe, false);
assert.equal(classifyRepeatDialogSaveControl('\u4e0b\u4e00\u6b65').safe, false);
assert.equal(classifyRepeatDialogSaveControl('Submit application').safe, false);
assert.equal(classifyRepeatDialogSaveControl('Pay now').safe, false);
assert.equal(isProtectedRepeatDialogControl('\u9009\u62e9\u5bfc\u5e08'), true);
assert.equal(isProtectedRepeatDialogControl('\u8f93\u5165\u9a8c\u8bc1\u7801'), true);
assert.equal(isProtectedRepeatDialogControl('Choose advisor'), true);
assert.equal(isProtectedRepeatDialogControl('Captcha'), true);
assert.equal(isProtectedRepeatDialogControl('\u4fdd\u5b58'), false);

assert.deepEqual(validateRepeatDialogCommit([
  { required: true, protected: false, kind: 'text', value: 'Family member' },
  { required: true, protected: false, kind: 'text', value: 'Parent' },
]), { safe: true, reason: 'ready' });
assert.deepEqual(validateRepeatDialogCommit([
  { required: true, protected: false, kind: 'text', value: '' },
]), { safe: false, reason: 'required-empty' });
assert.deepEqual(validateRepeatDialogCommit([
  { required: true, protected: true, kind: 'text', value: 'Do not commit' },
]), { safe: false, reason: 'protected-required' });

assert.deepEqual(selectRepeatDialogSaveCandidate([
  { id: 'save', label: '\u4fdd\u5b58', recordAssociated: true },
]), { id: 'save', reason: 'record-save' });
assert.deepEqual(selectRepeatDialogSaveCandidate([
  { id: 'picker-confirm', label: '\u786e\u5b9a', recordAssociated: false },
  { id: 'record-save', label: '\u4fdd\u5b58', recordAssociated: true },
]), { id: 'record-save', reason: 'record-save' });
assert.deepEqual(selectRepeatDialogSaveCandidate([
  { id: 'first', label: '\u4fdd\u5b58', recordAssociated: true },
  { id: 'second', label: '\u4fdd\u5b58', recordAssociated: true },
]), { id: undefined, reason: 'ambiguous-record-save' });

assert.deepEqual(selectRepeatDialogRoot([
  { id: 'existing', newlyOpened: false, leaf: true, groupMatched: true },
  { id: 'drawer', newlyOpened: true, leaf: true, groupMatched: true },
], true), { id: 'drawer', reason: 'dialog-root' });
assert.deepEqual(selectRepeatDialogRoot([
  { id: 'parent', newlyOpened: true, leaf: false, groupMatched: true },
  { id: 'child', newlyOpened: true, leaf: true, groupMatched: true },
], true), { id: 'child', reason: 'dialog-root' });
assert.deepEqual(selectRepeatDialogRoot([
  { id: 'first', newlyOpened: true, leaf: true, groupMatched: true },
  { id: 'second', newlyOpened: true, leaf: true, groupMatched: true },
], true), { id: undefined, reason: 'ambiguous-dialog-root' });

assert.equal(hasVerifiedRepeatRecordChange(
  { recordCount: 2, text: 'existing award' },
  { recordCount: 2, text: 'validation error message' },
  ['new award'],
), false, 'unrelated list text changes must never count as a record save');
assert.equal(hasVerifiedRepeatRecordChange(
  { recordCount: 2, text: 'existing award' },
  { recordCount: 3, text: 'existing award' },
  ['new award'],
), true, 'a new data row verifies the record save');
assert.equal(hasVerifiedRepeatRecordChange(
  { recordCount: 2, text: 'existing award' },
  { recordCount: 2, text: 'existing award new award' },
  ['new award'],
), true, 'a newly listed assigned value verifies the record save');
assert.equal(hasVerifiedRepeatRecordChange(
  { recordCount: 2, text: 'existing award common value' },
  { recordCount: 2, text: 'existing award common value changed' },
  ['common value'],
), false, 'an assigned value already present before saving is not evidence of a new record');

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
