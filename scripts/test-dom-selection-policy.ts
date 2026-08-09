import assert from 'node:assert/strict';
import {
  classifyRepeatableHeaderSchema,
  classifyRepeatPreparation,
  selectNewDialogRoot,
  selectScopedConfirm,
  selectScopedTrigger,
} from '../utils/dom-selection-policy';

assert.equal(classifyRepeatableHeaderSchema([
  '起始时间（日期格式：2019-11）',
  '结束时间（日期格式：2019-11）',
  '学校或工作单位',
  '担任职务',
]), '学习和工作经历', 'a school/work chronology table must not be classified as a project table');
assert.equal(classifyRepeatableHeaderSchema([
  '项目名称',
  '项目描述',
  '项目时间段',
  '本人角色',
]), '项目经历', 'project-specific columns should still classify as a project table');

assert.equal(
  classifyRepeatPreparation({ tableMatch: 'none', hasAddControl: false }),
  'skip',
  'a saved repeatable group that is absent from the current page must not pause continuous filling',
);
assert.equal(
  classifyRepeatPreparation({ tableMatch: 'strong', hasAddControl: false }),
  'failure',
  'a clearly present table without a safe add-row control still needs attention',
);
assert.equal(
  classifyRepeatPreparation({ tableMatch: 'strong', hasAddControl: true }),
  'prepare',
  'a clearly present table with a safe add-row control should be prepared',
);

const triggers = [
  { id: 'school-trigger', ownerId: 'school-input', distance: 24, label: '选择' },
  { id: 'department-trigger', ownerId: 'department-input', distance: 24, label: '选择' },
  { id: 'major-trigger', ownerId: 'major-input', distance: 24, label: '选择' },
  { id: 'unrelated-trigger', ownerId: 'other-input', distance: 4, label: '选择' },
];
assert.equal(selectScopedTrigger(triggers, 'school-input'), 'school-trigger');
assert.equal(selectScopedTrigger(triggers, 'department-input'), 'department-trigger');
assert.equal(selectScopedTrigger(triggers, 'major-input'), 'major-trigger');
assert.equal(selectScopedTrigger([
  { id: 'first', ownerId: 'school-input', distance: 10, label: '选择' },
  { id: 'second', ownerId: 'school-input', distance: 10, label: '选择' },
], 'school-input'), undefined, 'equally plausible triggers must pause instead of clicking the first one');

assert.equal(selectNewDialogRoot([
  { id: 'existing', wasVisibleBefore: true, associated: true },
  { id: 'new-school-dialog', wasVisibleBefore: false, associated: true },
  { id: 'new-unrelated-dialog', wasVisibleBefore: false, associated: false },
]), 'new-school-dialog');
assert.equal(selectNewDialogRoot([
  { id: 'first', wasVisibleBefore: false, associated: true },
  { id: 'second', wasVisibleBefore: false, associated: true },
]), undefined, 'multiple associated new dialogs must be treated as ambiguous');

assert.equal(selectScopedConfirm([
  { id: 'page-next', dialogId: undefined, label: '确定' },
  { id: 'dialog-confirm', dialogId: 'new-school-dialog', label: '确定' },
], 'new-school-dialog'), 'dialog-confirm');
assert.equal(selectScopedConfirm([
  { id: 'outside-confirm', dialogId: undefined, label: '确定' },
], 'new-school-dialog'), undefined, 'a confirmation button outside the chosen dialog must never be clicked');

console.log('DOM selection policy tests passed');
