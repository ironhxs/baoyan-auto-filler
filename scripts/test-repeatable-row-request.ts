import assert from 'node:assert/strict';
import {
  buildRepeatRowTargets,
  buildRepeatDialogTargets,
  isAddRowLabel,
  prepareRepeatableRowScan,
} from '../utils/repeatable-records';
import type { BlockCategory } from '../utils/db';
import type { FormFieldInfo } from '../utils/matcher';

const repeatableRecordsModule = await import('../utils/repeatable-records');
assert.equal(
  typeof repeatableRecordsModule.planRepeatRowPreparation,
  'function',
  'repeat row preparation must expose a safety plan based on rows added, not a hard total-row ceiling',
);
const planRepeatRowPreparation = repeatableRecordsModule.planRepeatRowPreparation as (
  requiredRows: number,
  currentRows: number,
) => { targetRows: number; truncated: boolean };

assert.deepEqual(
  planRepeatRowPreparation(18, 9),
  { targetRows: 18, truncated: false },
  'a real award page with 9 existing rows must be allowed to grow to 18 rows',
);
assert.deepEqual(
  planRepeatRowPreparation(18, 0),
  { targetRows: 18, truncated: false },
  'a normal profile with 18 award records must not be rejected by the old total-row limit of 10',
);
assert.deepEqual(
  planRepeatRowPreparation(80, 2),
  { targetRows: 26, truncated: true },
  'one preparation pass must still cap the number of newly created rows to prevent runaway loops',
);

assert.equal(
  typeof repeatableRecordsModule.limitRepeatRecordBatch,
  'function',
  'dialog-based repeat records must use the same additions-per-pass safety policy',
);
const limitRepeatRecordBatch = repeatableRecordsModule.limitRepeatRecordBatch as <T>(
  records: T[],
) => { records: T[]; truncated: boolean };
const normalDialogRecords = Array.from({ length: 18 }, (_, index) => index);
assert.deepEqual(
  limitRepeatRecordBatch(normalDialogRecords),
  { records: normalDialogRecords, truncated: false },
  '18 dialog records must no longer be rejected by the legacy limit of 10',
);
assert.deepEqual(
  limitRepeatRecordBatch(Array.from({ length: 40 }, (_, index) => index)),
  { records: Array.from({ length: 24 }, (_, index) => index), truncated: true },
  'dialog automation must retain a bounded batch for unexpectedly large profiles',
);

const AWARDS = '\u5956\u52b1\u60c5\u51b5';
const AWARD_NAME = '\u5956\u52b1\u540d\u79f0';

assert.equal(isAddRowLabel('\u65b0\u589e\u5956\u52b1'), true);
assert.equal(isAddRowLabel(' addAward '), true);
assert.equal(isAddRowLabel('\u63d0\u4ea4'), false, 'protected final actions must never look like add-row controls');

assert.deepEqual(buildRepeatRowTargets({ groups: {
  [AWARDS]: {
    groupLabel: AWARDS,
    itemCount: 2,
    existingRowCount: 0,
    rowBindings: [],
    missingItemIndexes: [0, 1],
    rowsToAdd: 2,
    unmatchedRowIndexes: [],
  },
} }), [{ groupLabel: AWARDS, requiredRows: 2, missingItemIndexes: [0, 1] }]);

const blocks: BlockCategory[] = [{
  title: AWARDS,
  sectionId: 'awards',
  items: [
    { fields: [{ key: AWARD_NAME, value: 'First award' }] },
    { fields: [{ key: AWARD_NAME, value: 'Second award' }] },
  ],
}];

const dialogTargets = buildRepeatDialogTargets({ groups: {
  [AWARDS]: {
    groupLabel: AWARDS,
    itemCount: 2,
    existingRowCount: 0,
    rowBindings: [],
    missingItemIndexes: [0, 1],
    rowsToAdd: 2,
    unmatchedRowIndexes: [],
  },
} }, blocks);
assert.deepEqual(dialogTargets, [{
  groupLabel: AWARDS,
  records: [
    { itemIndex: 0, fields: [{ key: AWARD_NAME, value: 'First award' }] },
    { itemIndex: 1, fields: [{ key: AWARD_NAME, value: 'Second award' }] },
  ],
}]);

let scanCount = 0;
let visibleFields: FormFieldInfo[] = [];
const result = await prepareRepeatableRowScan(
  async () => {
    scanCount++;
    return visibleFields.map((field, index) => ({ index, field }));
  },
  async (targets) => {
    assert.deepEqual(targets, [{
      groupLabel: AWARDS,
      requiredRows: 2,
      missingItemIndexes: [0, 1],
    }], 'row preparation must be requested from the scanned group plan');
    visibleFields = [0, 1].map((rowIndex) => ({
      index: rowIndex,
      kind: 'text',
      tag: 'input',
      type: 'text',
      name: '',
      id: '',
      label: AWARD_NAME,
      placeholder: '',
      ariaLabel: '',
      context: '',
      value: '',
      groupLabel: AWARDS,
      columnLabel: AWARD_NAME,
      rowIndex,
      repeatGroup: AWARDS,
      protected: false,
      protectionReason: '',
    } as FormFieldInfo));
    return { added: 2, failures: [] };
  },
  blocks,
  [],
);

assert.equal(scanCount, 2, 'row-aware collection must scan before planning and again after additions');
assert.equal(result.scanResults.length, 2, 'matching must receive the post-addition field set');
assert.deepEqual(result.preparation, { added: 2, failures: [] });

console.log('repeatable row request tests passed');
