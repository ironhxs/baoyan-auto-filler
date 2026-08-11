import assert from 'node:assert/strict';
import { decideRepeatRecordCommit } from '../utils/agent/repeat-commit-policy';

const matched = [
  { actionId: 'fill-family', targetId: 'family-name', matched: true },
  { actionId: 'fill-family', targetId: 'family-phone', matched: true },
];

assert.deepEqual(decideRepeatRecordCommit({
  targetIds: ['family-name', 'family-phone'],
  executionResults: matched,
  visibleDialogGroups: ['家庭成员'],
}), {
  action: 'commit',
  groupLabel: '家庭成员',
  committedTargetIds: ['family-name', 'family-phone'],
});

assert.deepEqual(decideRepeatRecordCommit({
  targetIds: ['family-name', 'family-phone'],
  executionResults: [matched[0], { ...matched[1], matched: false }],
  visibleDialogGroups: ['家庭成员'],
}), { action: 'skip', reason: 'record-fields-not-verified' });

assert.deepEqual(decideRepeatRecordCommit({
  targetIds: ['family-name'],
  executionResults: [matched[0]],
  visibleDialogGroups: ['家庭成员', '学科竞赛'],
}), { action: 'fail', reason: 'multiple-dialog-groups' });

assert.deepEqual(decideRepeatRecordCommit({
  targetIds: [],
  executionResults: [],
  visibleDialogGroups: ['家庭成员'],
}), { action: 'skip', reason: 'no-record-fields' });

console.log('agent repeat commit policy tests passed');
