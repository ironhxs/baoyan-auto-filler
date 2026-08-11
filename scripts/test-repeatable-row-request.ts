import assert from 'node:assert/strict';
import {
  buildRepeatRowTargets,
  buildRepeatDialogTargets,
  isAddRowLabel,
  prepareRepeatableRowScan,
  sameRepeatableGroupLabel,
} from '../utils/repeatable-records';
import type { BlockCategory } from '../utils/db';
import type { FormFieldInfo } from '../utils/matcher';

function formField(index: number, overrides: Partial<FormFieldInfo>): FormFieldInfo {
  return {
    index,
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    label: '',
    placeholder: '',
    ariaLabel: '',
    context: '',
    value: '',
    groupLabel: '',
    columnLabel: '',
    repeatGroup: '',
    protected: false,
    protectionReason: '',
    ...overrides,
  } as FormFieldInfo;
}

const repeatableRecordsModule = await import('../utils/repeatable-records');
assert.equal(
  typeof repeatableRecordsModule.forEachRepeatPreparationTarget,
  'function',
  'repeat-row preparation must expose a scheduler that stops the pass as soon as one dialog opens',
);
const forEachRepeatPreparationTarget = repeatableRecordsModule.forEachRepeatPreparationTarget as <T>(
  targets: T[],
  visit: (target: T) => Promise<'continue' | 'stop'>,
) => Promise<void>;
const visitedRepeatGroups: string[] = [];
await forEachRepeatPreparationTarget(
  ['\u9879\u76ee\u7ecf\u5386', '\u83b7\u5956\u60c5\u51b5'],
  async (groupLabel) => {
    visitedRepeatGroups.push(groupLabel);
    return 'stop';
  },
);
assert.deepEqual(
  visitedRepeatGroups,
  ['\u9879\u76ee\u7ecf\u5386'],
  'opening one record editor must prevent the same preparation pass from opening a second editor',
);
assert.equal(
  typeof repeatableRecordsModule.runSequentialRepeatPreparationPasses,
  'function',
  'repeatable dialog preparation must resume in a later pass after the current editor closes',
);
const runSequentialRepeatPreparationPasses = repeatableRecordsModule.runSequentialRepeatPreparationPasses as <T extends {
  dialogGroups: string[];
  stop?: boolean;
}>(runPass: (passIndex: number) => Promise<T>, maxPasses?: number) => Promise<{ passes: T[]; truncated: boolean }>;
const sequentialGroups = [
  ['\u9879\u76ee\u7ecf\u5386'],
  ['\u83b7\u5956\u60c5\u51b5'],
  [],
];
const sequentialPreparation = await runSequentialRepeatPreparationPasses(
  async (passIndex) => ({ dialogGroups: sequentialGroups[passIndex] ?? [] }),
  6,
);
assert.deepEqual(
  sequentialPreparation.passes.map((pass) => pass.dialogGroups),
  sequentialGroups,
  'closing the first editor must allow the next dynamic group to be discovered and processed',
);
assert.equal(sequentialPreparation.truncated, false);
assert.equal(
  typeof repeatableRecordsModule.buildRepeatDialogTargetSchemas,
  'function',
  'dynamic dialogs must expose their current field order and required flags as a projection schema',
);
const buildRepeatDialogTargetSchemas = repeatableRecordsModule.buildRepeatDialogTargetSchemas as (
  fields: FormFieldInfo[],
  observations: Array<{
    groupLabel: string;
    presentation: 'inline' | 'dialog' | 'unknown';
    tableHeaders: string[];
    fieldLabels: string[];
    currentRowCount: number;
    hasAddControl: boolean;
    dialogVisible: boolean;
  }>,
) => Array<{ groupLabel: string; fields: Array<{ key: string; label: string; required?: boolean; multiline?: boolean }> }>;
assert.deepEqual(buildRepeatDialogTargetSchemas([
  formField(100, { name: 'xmmc', label: '\u9879\u76ee\u540d\u79f0', groupLabel: '\u9879\u76ee\u7ecf\u5386', repeatGroup: '\u9879\u76ee\u7ecf\u5386', required: true }),
  formField(101, { name: 'xmms', tag: 'textarea', label: '\u9879\u76ee\u63cf\u8ff0', groupLabel: '\u9879\u76ee\u7ecf\u5386', repeatGroup: '\u9879\u76ee\u7ecf\u5386', required: true }),
  formField(102, { name: 'xmsjd', label: '\u9879\u76ee\u65f6\u95f4\u6bb5', groupLabel: '\u9879\u76ee\u7ecf\u5386', repeatGroup: '\u9879\u76ee\u7ecf\u5386', required: true }),
  formField(103, { name: 'brjs', label: '\u672c\u4eba\u89d2\u8272', groupLabel: '\u9879\u76ee\u7ecf\u5386', repeatGroup: '\u9879\u76ee\u7ecf\u5386', required: true }),
], [{
  groupLabel: '\u9879\u76ee\u7ecf\u5386',
  presentation: 'dialog',
  tableHeaders: ['\u9879\u76ee\u540d\u79f0', '\u9879\u76ee\u63cf\u8ff0', '\u9879\u76ee\u65f6\u95f4\u6bb5', '\u672c\u4eba\u89d2\u8272'],
  fieldLabels: ['\u9879\u76ee\u540d\u79f0', '\u9879\u76ee\u63cf\u8ff0', '\u9879\u76ee\u65f6\u95f4\u6bb5', '\u672c\u4eba\u89d2\u8272'],
  currentRowCount: 0,
  hasAddControl: true,
  dialogVisible: true,
}]), [{
  groupLabel: '\u9879\u76ee\u7ecf\u5386',
  fields: [
    { key: '\u9879\u76ee\u540d\u79f0', label: '\u9879\u76ee\u540d\u79f0', required: true, multiline: false },
    { key: '\u9879\u76ee\u63cf\u8ff0', label: '\u9879\u76ee\u63cf\u8ff0', required: true, multiline: true },
    { key: '\u9879\u76ee\u65f6\u95f4\u6bb5', label: '\u9879\u76ee\u65f6\u95f4\u6bb5', required: true, multiline: false },
    { key: '\u672c\u4eba\u89d2\u8272', label: '\u672c\u4eba\u89d2\u8272', required: true, multiline: false },
  ],
}], 'the schema must preserve the live dialog field order instead of assuming one school-specific order');
const annotatedDialogSchema = buildRepeatDialogTargetSchemas([
  formField(104, {
    name: 'brjs',
    label: '\u672c\u4eba\u89d2\u8272',
    groupLabel: '\u9879\u76ee\u7ecf\u5386',
    repeatGroup: '\u9879\u76ee\u7ecf\u5386',
    required: true,
    hint: '\u8bf7\u4f9d\u636e\u8d44\u6599\u4e2d\u7684\u6392\u540d\u6216\u660e\u786e\u804c\u52a1\u586b\u5199',
    dateFormat: 'YYYY-MM',
    options: ['\u9879\u76ee\u8d1f\u8d23\u4eba', '\u9879\u76ee\u6210\u5458'],
    maxLength: 40,
    forbiddenCharacters: ['|', '#'],
    value: '\u7f51\u9875\u5df2\u6709\u503c',
    protected: true,
  }),
], [{
  groupLabel: '\u9879\u76ee\u7ecf\u5386',
  presentation: 'dialog',
  tableHeaders: [],
  fieldLabels: ['\u672c\u4eba\u89d2\u8272'],
  currentRowCount: 0,
  hasAddControl: true,
  dialogVisible: true,
}]);
assert.deepEqual(annotatedDialogSchema[0].fields[0], {
  key: '\u672c\u4eba\u89d2\u8272',
  label: '\u672c\u4eba\u89d2\u8272',
  required: true,
  multiline: false,
  currentValue: '\u7f51\u9875\u5df2\u6709\u503c',
  protected: true,
  options: ['\u9879\u76ee\u8d1f\u8d23\u4eba', '\u9879\u76ee\u6210\u5458'],
  formatHints: ['YYYY-MM'],
  forbiddenCharacters: ['|', '#'],
  maxLength: 40,
  annotations: ['\u8bf7\u4f9d\u636e\u8d44\u6599\u4e2d\u7684\u6392\u540d\u6216\u660e\u786e\u804c\u52a1\u586b\u5199', 'YYYY-MM'],
}, 'the live dialog schema must retain comments, formats, options and protected current values for Agent planning');
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
    {
      itemIndex: 0,
      fields: [{ key: AWARD_NAME, value: 'First award' }],
      sourceRecord: {
        recordId: 'awards:0',
        categoryId: 'awards',
        categoryLabel: AWARDS,
        itemIndex: 0,
        fields: { [AWARD_NAME]: 'First award' },
        searchText: `${AWARD_NAME}: First award`,
      },
    },
    {
      itemIndex: 1,
      fields: [{ key: AWARD_NAME, value: 'Second award' }],
      sourceRecord: {
        recordId: 'awards:1',
        categoryId: 'awards',
        categoryLabel: AWARDS,
        itemIndex: 1,
        fields: { [AWARD_NAME]: 'Second award' },
        searchText: `${AWARD_NAME}: Second award`,
      },
    },
  ],
}]);

const SYSU_PROJECT = '\u9879\u76ee\u7ecf\u5386';
const SYSU_AWARD = '\u83b7\u5956\u60c5\u51b5';
const projectionBlocks: BlockCategory[] = [{
  title: '\u79d1\u7814\u8bad\u7ec3',
  sectionId: 'research_training',
  items: [{ fields: [
    { key: '\u8d77\u6b62\u65f6\u95f4', value: '2025.07-2026.07' },
    { key: '\u9879\u76ee\u540d\u79f0', value: 'PRISM-Net' },
    { key: '\u9879\u76ee\u63cf\u8ff0', value: '\u9762\u5411\u7f3a\u5931\u6a21\u6001\u8111\u80bf\u7624\u5206\u5272' },
    { key: '\u672c\u4eba\u89d2\u8272', value: '\u9879\u76ee\u8d1f\u8d23\u4eba' },
  ] }],
}, {
  title: '\u5b66\u79d1\u7ade\u8d5b',
  sectionId: 'subject_competitions',
  items: [{ fields: [
    { key: '\u83b7\u5956\u9879\u76ee\u540d\u79f0', value: 'OopsOS' },
    { key: '\u7ade\u8d5b\u540d\u79f0', value: '\u5168\u56fd\u5927\u5b66\u751f\u8ba1\u7b97\u673a\u7cfb\u7edf\u80fd\u529b\u5927\u8d5b' },
    { key: '\u83b7\u5956\u7b49\u7ea7', value: '\u534e\u4e1c\u533a\u57df\u8d5b\u4e09\u7b49\u5956' },
    { key: '\u83b7\u5956\u65f6\u95f4', value: '2026-01' },
    { key: '\u4e3b\u529e\u5355\u4f4d', value: '\u5927\u8d5b\u7ec4\u59d4\u4f1a' },
    { key: '\u63cf\u8ff0', value: '\u5c0f\u578b\u64cd\u4f5c\u7cfb\u7edf\u5185\u6838\u6269\u5c55' },
    { key: '\u672c\u4eba\u6392\u540d', value: '1' },
  ] }],
}, {
  title: '\u672c\u79d1\u671f\u95f4\u6821\u7ea7\u4ee5\u4e0a\uff08\u542b\uff09\u8363\u8a89\u5956\u52b1',
  sectionId: 'honors_awards',
  items: [{ fields: [
    { key: '\u83b7\u5956\u540d\u79f0', value: '\u4e00\u7b49\u5956\u5b66\u91d1' },
    { key: '\u83b7\u5956\u7b49\u7ea7', value: '\u6821\u7ea7' },
    { key: '\u83b7\u5956\u65f6\u95f4', value: '2025-12' },
  ] }],
}];
const sysuDialogTargets = buildRepeatDialogTargets({ groups: {
  [SYSU_PROJECT]: {
    groupLabel: SYSU_PROJECT,
    itemCount: 1,
    existingRowCount: 0,
    rowBindings: [],
    missingItemIndexes: [0],
    rowsToAdd: 1,
    unmatchedRowIndexes: [],
  },
  [SYSU_AWARD]: {
    groupLabel: SYSU_AWARD,
    itemCount: 2,
    existingRowCount: 0,
    rowBindings: [],
    missingItemIndexes: [0, 1],
    rowsToAdd: 2,
    unmatchedRowIndexes: [],
  },
} }, projectionBlocks, [{
  groupLabel: SYSU_PROJECT,
  fields: [
    { key: '\u9879\u76ee\u540d\u79f0', label: '\u9879\u76ee\u540d\u79f0', required: true },
    { key: '\u9879\u76ee\u63cf\u8ff0', label: '\u9879\u76ee\u63cf\u8ff0', required: true },
    { key: '\u9879\u76ee\u65f6\u95f4\u6bb5', label: '\u9879\u76ee\u65f6\u95f4\u6bb5', required: true },
    { key: '\u672c\u4eba\u89d2\u8272', label: '\u672c\u4eba\u89d2\u8272', required: true },
  ],
}, {
  groupLabel: SYSU_AWARD,
  fields: [
    { key: '\u5956\u9879\u540d\u79f0', label: '\u5956\u9879\u540d\u79f0', required: true },
    { key: '\u5956\u9879\u7ea7\u522b', label: '\u5956\u9879\u7ea7\u522b', required: true },
    { key: '\u5956\u9879\u7b49\u7ea7', label: '\u5956\u9879\u7b49\u7ea7', required: true },
    { key: '\u83b7\u5956\u65f6\u95f4', label: '\u83b7\u5956\u65f6\u95f4', required: true },
    { key: '\u4e3b\u529e\u5355\u4f4d', label: '\u4e3b\u529e\u5355\u4f4d', required: true },
    { key: '\u63cf\u8ff0', label: '\u63cf\u8ff0', required: true },
    { key: '\u672c\u4eba\u6392\u540d', label: '\u672c\u4eba\u6392\u540d', required: true },
  ],
}]);
assert.deepEqual(sysuDialogTargets, [{
  groupLabel: SYSU_PROJECT,
  records: [{
    itemIndex: 0,
    fields: [
      { key: '\u9879\u76ee\u540d\u79f0', value: 'PRISM-Net' },
      { key: '\u9879\u76ee\u63cf\u8ff0', value: '\u9762\u5411\u7f3a\u5931\u6a21\u6001\u8111\u80bf\u7624\u5206\u5272' },
      { key: '\u9879\u76ee\u65f6\u95f4\u6bb5', value: '2025.07-2026.07' },
      { key: '\u672c\u4eba\u89d2\u8272', value: '\u9879\u76ee\u8d1f\u8d23\u4eba' },
    ],
    sourceRecord: {
      recordId: 'research_training:0',
      categoryId: 'research_training',
      categoryLabel: '\u79d1\u7814\u8bad\u7ec3',
      itemIndex: 0,
      fields: {
        '\u8d77\u6b62\u65f6\u95f4': '2025.07-2026.07',
        '\u9879\u76ee\u540d\u79f0': 'PRISM-Net',
        '\u9879\u76ee\u63cf\u8ff0': '\u9762\u5411\u7f3a\u5931\u6a21\u6001\u8111\u80bf\u7624\u5206\u5272',
        '\u672c\u4eba\u89d2\u8272': '\u9879\u76ee\u8d1f\u8d23\u4eba',
      },
      searchText: '\u8d77\u6b62\u65f6\u95f4: 2025.07-2026.07\uff1b\u9879\u76ee\u540d\u79f0: PRISM-Net\uff1b\u9879\u76ee\u63cf\u8ff0: \u9762\u5411\u7f3a\u5931\u6a21\u6001\u8111\u80bf\u7624\u5206\u5272\uff1b\u672c\u4eba\u89d2\u8272: \u9879\u76ee\u8d1f\u8d23\u4eba',
    },
  }],
}, {
  groupLabel: SYSU_AWARD,
  records: [{
    itemIndex: 0,
    fields: [
      { key: '\u5956\u9879\u540d\u79f0', value: 'OopsOS' },
      { key: '\u5956\u9879\u7ea7\u522b', value: '\u534e\u4e1c\u533a\u57df\u8d5b' },
      { key: '\u5956\u9879\u7b49\u7ea7', value: '\u4e09\u7b49\u5956' },
      { key: '\u83b7\u5956\u65f6\u95f4', value: '2026-01' },
      { key: '\u4e3b\u529e\u5355\u4f4d', value: '\u5927\u8d5b\u7ec4\u59d4\u4f1a' },
      { key: '\u63cf\u8ff0', value: '\u5c0f\u578b\u64cd\u4f5c\u7cfb\u7edf\u5185\u6838\u6269\u5c55' },
      { key: '\u672c\u4eba\u6392\u540d', value: '1' },
    ],
    sourceRecord: {
      recordId: 'subject_competitions:0',
      categoryId: 'subject_competitions',
      categoryLabel: '\u5b66\u79d1\u7ade\u8d5b',
      itemIndex: 0,
      fields: {
        '\u83b7\u5956\u9879\u76ee\u540d\u79f0': 'OopsOS',
        '\u7ade\u8d5b\u540d\u79f0': '\u5168\u56fd\u5927\u5b66\u751f\u8ba1\u7b97\u673a\u7cfb\u7edf\u80fd\u529b\u5927\u8d5b',
        '\u83b7\u5956\u7b49\u7ea7': '\u534e\u4e1c\u533a\u57df\u8d5b\u4e09\u7b49\u5956',
        '\u83b7\u5956\u65f6\u95f4': '2026-01',
        '\u4e3b\u529e\u5355\u4f4d': '\u5927\u8d5b\u7ec4\u59d4\u4f1a',
        '\u63cf\u8ff0': '\u5c0f\u578b\u64cd\u4f5c\u7cfb\u7edf\u5185\u6838\u6269\u5c55',
        '\u672c\u4eba\u6392\u540d': '1',
      },
      searchText: '\u83b7\u5956\u9879\u76ee\u540d\u79f0: OopsOS\uff1b\u7ade\u8d5b\u540d\u79f0: \u5168\u56fd\u5927\u5b66\u751f\u8ba1\u7b97\u673a\u7cfb\u7edf\u80fd\u529b\u5927\u8d5b\uff1b\u83b7\u5956\u7b49\u7ea7: \u534e\u4e1c\u533a\u57df\u8d5b\u4e09\u7b49\u5956\uff1b\u83b7\u5956\u65f6\u95f4: 2026-01\uff1b\u4e3b\u529e\u5355\u4f4d: \u5927\u8d5b\u7ec4\u59d4\u4f1a\uff1b\u63cf\u8ff0: \u5c0f\u578b\u64cd\u4f5c\u7cfb\u7edf\u5185\u6838\u6269\u5c55\uff1b\u672c\u4eba\u6392\u540d: 1',
    },
  }, {
    itemIndex: 1,
    fields: [
      { key: '\u5956\u9879\u540d\u79f0', value: '\u4e00\u7b49\u5956\u5b66\u91d1' },
      { key: '\u5956\u9879\u7ea7\u522b', value: '\u6821\u7ea7' },
      { key: '\u83b7\u5956\u65f6\u95f4', value: '2025-12' },
    ],
    sourceRecord: {
      recordId: 'honors_awards:0',
      categoryId: 'honors_awards',
      categoryLabel: '\u672c\u79d1\u671f\u95f4\u6821\u7ea7\u4ee5\u4e0a\uff08\u542b\uff09\u8363\u8a89\u5956\u52b1',
      itemIndex: 0,
      fields: {
        '\u83b7\u5956\u540d\u79f0': '\u4e00\u7b49\u5956\u5b66\u91d1',
        '\u83b7\u5956\u7b49\u7ea7': '\u6821\u7ea7',
        '\u83b7\u5956\u65f6\u95f4': '2025-12',
      },
      searchText: '\u83b7\u5956\u540d\u79f0: \u4e00\u7b49\u5956\u5b66\u91d1\uff1b\u83b7\u5956\u7b49\u7ea7: \u6821\u7ea7\uff1b\u83b7\u5956\u65f6\u95f4: 2025-12',
    },
  }],
}], 'dynamic record targets must be projected into the current dialog schema without crossing source records');

const FAMILY_GROUP = '\u5bb6\u5ead\u6210\u5458';
const FAMILY_DIALOG_GROUP = '\u5bb6\u5ead\u4e3b\u8981\u6210\u5458';
const familyTargets = buildRepeatDialogTargets({ groups: {
  [FAMILY_GROUP]: {
    groupLabel: FAMILY_GROUP,
    itemCount: 1,
    existingRowCount: 0,
    rowBindings: [],
    missingItemIndexes: [0],
    rowsToAdd: 1,
    unmatchedRowIndexes: [],
  },
} }, [{
  title: '\u5bb6\u5ead\u6210\u5458',
  sectionId: 'family',
  items: [{ fields: [
    { key: '\u59d3\u540d', value: '\u6d4b\u8bd5\u6210\u5458\u7532' },
    { key: '\u5173\u7cfb', value: '\u6bcd\u5b50' },
    { key: '\u5de5\u4f5c\u5355\u4f4d\u53ca\u804c\u52a1', value: '\u6d4b\u8bd5\u5355\u4f4d' },
    { key: '\u8054\u7cfb\u7535\u8bdd', value: '13800000000' },
  ] }],
}], [{
  groupLabel: FAMILY_DIALOG_GROUP,
  fields: [
    { key: '\u6210\u5458\u59d3\u540d', label: '\u6210\u5458\u59d3\u540d', required: true },
    { key: '\u4e0e\u672c\u4eba\u5173\u7cfb', label: '\u4e0e\u672c\u4eba\u5173\u7cfb', required: true },
    { key: '\u6240\u5728\u5355\u4f4d\u53ca\u804c\u52a1', label: '\u6240\u5728\u5355\u4f4d\u53ca\u804c\u52a1', required: true },
    { key: '\u624b\u673a\u53f7\u7801', label: '\u624b\u673a\u53f7\u7801', required: true },
  ],
}]);
assert.deepEqual(familyTargets[0]?.records[0]?.fields, [
  { key: '\u6210\u5458\u59d3\u540d', value: '\u6d4b\u8bd5\u6210\u5458\u7532' },
  { key: '\u4e0e\u672c\u4eba\u5173\u7cfb', value: '\u6bcd\u5b50' },
  { key: '\u6240\u5728\u5355\u4f4d\u53ca\u804c\u52a1', value: '\u6d4b\u8bd5\u5355\u4f4d' },
  { key: '\u624b\u673a\u53f7\u7801', value: '13800000000' },
], 'family records should project into live dialog labels instead of relying on one site\'s exact field names');
assert.equal(familyTargets[0]?.records[0]?.sourceRecord.categoryId, 'family');
assert.equal(sameRepeatableGroupLabel('\u83b7\u5956\u60c5\u51b5', '\u83b7\u5956\u9879\u76ee'), true);
assert.equal(
  sameRepeatableGroupLabel('\u9879\u76ee\u7ecf\u5386', '\u83b7\u5956\u9879\u76ee'),
  false,
  'an award-project label must not be classified as an ordinary project group',
);

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

const skippedGroupBlocks: BlockCategory[] = [{
  title: 'First dynamic group',
  items: [{ fields: [{ key: 'Name', value: 'First record' }] }],
}, {
  title: 'Second dynamic group',
  items: [{ fields: [{ key: 'Name', value: 'Second record' }] }],
}];
let skippedTargetRequest: Array<{ groupLabel: string; requiredRows: number; missingItemIndexes: number[] }> = [];
await prepareRepeatableRowScan(
  async () => [],
  async (targets) => {
    skippedTargetRequest = targets;
    return { added: 0, failures: [] };
  },
  skippedGroupBlocks,
  [],
  new Set(['First dynamic group']),
);
assert.deepEqual(skippedTargetRequest, [{
  groupLabel: 'Second dynamic group',
  requiredRows: 1,
  missingItemIndexes: [0],
}], 'a safely dismissed failed group must be skipped so another independent group can continue');

console.log('repeatable row request tests passed');
