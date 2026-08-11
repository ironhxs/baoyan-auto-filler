import assert from 'node:assert/strict';
import { selectAdjacentRepeatGroupSurface } from '../utils/repeat-group-surface';

const familyGroup = '\u5bb6\u5ead\u6210\u5458';
const awardGroup = '\u83b7\u5956\u60c5\u51b5';

assert.deepEqual(selectAdjacentRepeatGroupSurface({
  targetGroup: familyGroup,
  headingGroup: familyGroup,
  following: [
    { id: 'family-table', kind: 'table', visible: true },
    { id: 'family-add', kind: 'add', visible: true },
  ],
}), {
  tableId: 'family-table',
  addControlId: 'family-add',
  reason: 'surface',
}, 'a visible virtual table followed by its add control must form one repeat surface');

assert.deepEqual(selectAdjacentRepeatGroupSurface({
  targetGroup: familyGroup,
  headingGroup: '\u5907\u6ce8',
  following: [
    { id: 'notes-textarea', kind: 'other', visible: true },
    { id: 'family-heading', kind: 'heading', visible: true },
    { id: 'family-table', kind: 'table', visible: true },
    { id: 'family-add', kind: 'add', visible: true },
  ],
}), {
  tableId: undefined,
  addControlId: undefined,
  reason: 'heading-mismatch',
}, 'a previous unrelated heading must never capture the next repeat group');

assert.deepEqual(selectAdjacentRepeatGroupSurface({
  targetGroup: familyGroup,
  headingGroup: familyGroup,
  following: [
    { id: 'family-table', kind: 'table', visible: true },
    { id: 'award-heading', kind: 'heading', visible: true },
    { id: 'award-table', kind: 'table', visible: true },
    { id: 'award-add', kind: 'add', visible: true },
  ],
}), {
  tableId: 'family-table',
  addControlId: undefined,
  reason: 'surface-without-add',
}, 'the search must stop at the next heading instead of stealing another group\'s add control');

assert.deepEqual(selectAdjacentRepeatGroupSurface({
  targetGroup: awardGroup,
  headingGroup: awardGroup,
  following: [
    { id: 'unrelated-add', kind: 'add', visible: true },
    { id: 'award-table', kind: 'table', visible: true },
    { id: 'award-add', kind: 'add', visible: true },
  ],
}), {
  tableId: 'award-table',
  addControlId: 'award-add',
  reason: 'surface',
}, 'only an add control after the matched table belongs to the repeat group');

assert.deepEqual(selectAdjacentRepeatGroupSurface({
  targetGroup: familyGroup,
  headingGroup: familyGroup,
  following: [
    { id: 'hidden-table', kind: 'table', visible: false },
    { id: 'family-add', kind: 'add', visible: true },
  ],
}), {
  tableId: undefined,
  addControlId: undefined,
  reason: 'table-not-found',
}, 'a hidden template table must not be treated as the active repeat group');

console.log('repeat group surface tests passed');
