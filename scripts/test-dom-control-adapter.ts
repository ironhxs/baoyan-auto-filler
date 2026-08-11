import assert from 'node:assert/strict';
import {
  classifyDomControl,
  collectDisplayValueCandidates,
  createDomControlInteractionPlan,
  datePickerValuesEquivalent,
  getCascaderNodeActivationSelectors,
  getOverlayRootSelectors,
  getOverlaySelectors,
  isActionableOverlayCandidate,
  isActionableOverlaySurface,
  isPlaceholderValue,
  parseDatePickerTarget,
  pickCascaderExplorationLabels,
  pickControlIdentityCandidate,
  pickHierarchicalSegment,
  selectionTextsEquivalent,
  type DomControlProbe,
} from '../utils/dom-control-adapter';

const selectProbe: DomControlProbe = {
  tagName: 'input',
  type: 'text',
  value: '',
  placeholder: '请选择',
  readOnly: true,
  disabled: false,
  role: '',
  classNames: ['el-input__inner'],
  ancestorClassNames: ['el-select el-select--small', 'res-select item--readonly item_select'],
  attributes: { xtype: 'select', name: 'mzm', appendtobody: 'true' },
  labelText: '民族',
  visibleSelectionText: '汉族',
};

assert.equal(
  classifyDomControl(selectProbe),
  'select',
  'Element-style res-select controls must be classified as selectable controls',
);
assert.deepEqual(
  collectDisplayValueCandidates(selectProbe),
  ['汉族'],
  'a visible custom-select label must be used when the backing input value is empty',
);
assert.deepEqual(
  collectDisplayValueCandidates({
    ...selectProbe,
    value: '国家级',
    placeholder: '国家级',
    visibleSelectionText: '',
  }),
  ['国家级'],
  'a selected readonly custom-select value must survive when Element UI mirrors it into placeholder',
);
assert.equal(isPlaceholderValue('请选择'), true);
assert.equal(isPlaceholderValue('汉族'), false);
assert.equal(selectionTextsEquivalent('中共预备党员', '中国共产党预备党员'), true);
assert.equal(selectionTextsEquivalent('共青团员', '中国共产主义青年团团员'), true);
assert.equal(selectionTextsEquivalent('群众', '中国共产党党员'), false);
assert.equal(
  pickControlIdentityCandidate(
    { tagName: 'input', name: 'zzmmm' },
    [
      { tagName: 'input', name: 'mzm' },
      { tagName: 'input', name: 'zzmmm' },
    ],
  ),
  1,
  'a rerendered custom control must be rebound by its stable field identity before readback',
);

assert.equal(
  classifyDomControl({
    tagName: 'input',
    type: 'text',
    classNames: ['el-input__inner'],
    ancestorClassNames: ['res-input item_text'],
    labelText: '选择中山大学的原因',
  }),
  'text',
  'wording in a normal text-field label must not turn it into a custom selector',
);

const cascaderProbe: DomControlProbe = {
  ...selectProbe,
  value: '',
  visibleSelectionText: '',
  ancestorClassNames: ['el-cascader el-cascader--small', 'res-cascader item--readonly item_select-tree'],
  attributes: { xtype: 'select-tree', name: 'csdm', appendtobody: 'true' },
  labelText: '出生地',
};
assert.equal(
  classifyDomControl(cascaderProbe),
  'cascader',
  'Element-style res-cascader controls must be classified as hierarchical selectors',
);
const schoolInteractionPlan = createDomControlInteractionPlan(cascaderProbe);
assert.equal(
  classifyDomControl({
    ...cascaderProbe,
    ancestorClassNames: [],
    attributes: {},
  }),
  'text',
  'a detached backing input no longer carries the custom-control markers from its former ancestors',
);
assert.equal(
  schoolInteractionPlan.kind,
  'cascader',
  'the dialog interaction plan must preserve the control kind captured before opening rerenders the field',
);

const dateProbe: DomControlProbe = {
  tagName: 'input',
  type: 'text',
  value: '',
  placeholder: '请选择',
  readOnly: false,
  disabled: false,
  role: '',
  classNames: ['el-input__inner'],
  ancestorClassNames: ['el-date-editor el-input el-date-editor--date', 'res-date-picker item--readonly item_date-picker'],
  attributes: {
    xtype: 'date-local',
    name: 'jdyxrxny',
    format: 'yyyy-MM-dd',
    'value-format': 'yyyy-MM-dd',
    maxlength: '7',
  },
  labelText: '入学年月',
};
assert.equal(
  classifyDomControl(dateProbe),
  'date-picker',
  'res-date-picker and el-date-editor controls must be recognized without WdatePicker',
);

assert.ok(getOverlaySelectors('select').includes('.el-select-dropdown'));
assert.ok(getOverlaySelectors('cascader').includes('.el-cascader-panel'));
assert.ok(getOverlaySelectors('date-picker').includes('.el-picker-panel'));
assert.equal(
  getOverlaySelectors('text').includes('.el-select-dropdown'),
  false,
  'plain text fields must not cause unrelated popup roots to be scanned',
);
assert.deepEqual(
  getOverlayRootSelectors('select').filter((selector) => selector.startsWith('.el-select')),
  ['.el-select-dropdown'],
  'selection overlay discovery must return a single stable root instead of nested list wrappers',
);
assert.ok(getOverlayRootSelectors('cascader').includes('.el-cascader__dropdown'));
assert.ok(getOverlayRootSelectors('date-picker').includes('.el-picker-panel'));

assert.equal(
  isActionableOverlaySurface({
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    width: 228,
    height: 0,
    className: 'el-select-dropdown el-popper el-zoom-in-top-enter el-zoom-in-top-enter-active',
    candidateCount: 5,
  }),
  true,
  'an Element UI select entering at scaleY(0) must remain actionable when its real options are already present',
);
assert.equal(
  isActionableOverlaySurface({
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    width: 228,
    height: 0,
    className: 'el-select-dropdown el-popper el-zoom-in-top-leave el-zoom-in-top-leave-active',
    candidateCount: 5,
  }),
  false,
  'a closing Element UI overlay must not be mistaken for a newly actionable option surface',
);
assert.equal(
  isActionableOverlayCandidate(
    {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      width: 228,
      height: 0,
      className: 'el-select-dropdown el-popper el-zoom-in-top-enter el-zoom-in-top-enter-active',
      candidateCount: 5,
    },
    {
      display: 'list-item',
      visibility: 'visible',
      opacity: '1',
      width: 227,
      height: 0,
      className: 'el-select-dropdown__item',
      candidateCount: 0,
    },
  ),
  true,
  'an option inside the entering Element UI surface must be clickable even before its scale transition produces height',
);

assert.deepEqual(
  parseDatePickerTarget('2027年6月'),
  { year: 2027, month: 6, day: undefined },
  'year-month profile values must be parsed before interacting with a date picker',
);
assert.deepEqual(
  parseDatePickerTarget('2025-01-08'),
  { year: 2025, month: 1, day: 8 },
  'full dates must retain their day when the page asks for one',
);
assert.equal(
  datePickerValuesEquivalent('20260101', '2026-01'),
  true,
  'a page-supplied first day must match a profile value that only specifies year and month',
);
assert.equal(
  datePickerValuesEquivalent('20260102', '2026-01-01'),
  false,
  'a profile value with an explicit day must still require the same observed day',
);

const firstSegment = pickHierarchicalSegment('山东省潍坊市临朐县', ['山东省', '河北省']);
assert.deepEqual(firstSegment, { label: '山东省', remaining: '潍坊市临朐县' });
const secondSegment = pickHierarchicalSegment(firstSegment?.remaining ?? '', ['济南市', '潍坊市']);
assert.deepEqual(secondSegment, { label: '潍坊市', remaining: '临朐县' });
const finalSegment = pickHierarchicalSegment(secondSegment?.remaining ?? '', ['临朐县', '青州市']);
assert.deepEqual(finalSegment, { label: '临朐县', remaining: '' });

assert.deepEqual(
  pickCascaderExplorationLabels('山东省潍坊市临朐县', ['北京市', '安徽省', '山东省']),
  [],
  'an address with a direct first-level match must not trigger blind branch exploration',
);
assert.deepEqual(
  pickCascaderExplorationLabels('合肥工业大学', ['北京市', '安徽省', '山东省']),
  ['北京市', '安徽省', '山东省'],
  'a leaf-only school name must explore first-level branches when no direct path prefix exists',
);
assert.equal(
  selectionTextsEquivalent('10359 合肥工业大学', '合肥工业大学'),
  true,
  'a coded school option must match the profile school name after removing its numeric prefix',
);

assert.deepEqual(
  getCascaderNodeActivationSelectors(false),
  ['.el-cascader-node__label'],
  'a non-terminal cascader segment must expand through its visible label',
);
assert.deepEqual(
  getCascaderNodeActivationSelectors(true),
  [
    'label[role="radio"]',
    '.el-radio',
    '.el-radio__input',
    '.el-cascader-node__label',
  ],
  'a terminal Element cascader node must activate its radio before falling back to the row label',
);

console.log('DOM control adapter tests passed');
