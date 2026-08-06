import assert from 'node:assert/strict';
import {
  buildRepeatRowTargets,
  prepareRepeatableRowScan,
} from '../utils/repeatable-records';
import type { BlockCategory } from '../utils/db';
import type { FormFieldInfo } from '../utils/matcher';

const AWARDS = '\u5956\u52b1\u60c5\u51b5';
const AWARD_NAME = '\u5956\u52b1\u540d\u79f0';

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
