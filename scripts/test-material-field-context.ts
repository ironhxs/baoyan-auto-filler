import assert from 'node:assert/strict';

import { materialFieldDisplayLabel, materialFieldRoleTexts } from '../utils/material-field-context';

const blankUpload = materialFieldRoleTexts({
  label: '',
  hint: '',
  placeholder: '',
  ariaLabel: '',
  title: '',
  name: 'uploadFile',
  id: 'uploadFile',
  context: '',
  html: '<input type="file" name="uploadFile">',
}, '上传照片');
assert.equal(blankUpload.direct.includes('上传照片'), false);
assert.equal(blankUpload.fallback.includes('上传照片'), true, 'an unlabeled file input must inherit the current page title as fallback material semantics');
assert.equal(materialFieldDisplayLabel({ label: '', name: 'uploadFile', id: 'uploadFile' }, '上传照片', 0), '上传照片');

const identityField = {
  label: '身份证正面',
  hint: '',
  placeholder: '',
  ariaLabel: '',
  title: '',
  name: 'file',
  id: 'file',
  context: '',
  html: '',
};
const explicitIdentity = materialFieldRoleTexts(identityField, '上传材料');
assert.equal(explicitIdentity.direct.includes('身份证正面'), true);
assert.equal(explicitIdentity.direct.includes('上传材料'), false, 'a generic page title must not dilute an explicit field label');
assert.equal(materialFieldDisplayLabel(identityField, '上传材料', 0), '身份证正面');
assert.equal(materialFieldDisplayLabel({ label: '', name: 'file', id: 'file' }, '上传材料', 2), '上传材料（第3项）');

console.log('material field context tests passed');
