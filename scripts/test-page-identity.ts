import assert from 'node:assert/strict';
import { semanticPageKey } from '../utils/page-identity';

const base = {
  url: 'https://apply.example.edu/form',
  label: '基本信息',
  signature: 'https://apply.example.edu/form::基本信息::INPUT:name',
};

const basicKey = semanticPageKey(base);
const educationKey = semanticPageKey({
  url: base.url,
  label: '学习信息',
  signature: 'https://apply.example.edu/form::学习信息::INPUT:school|INPUT:major',
});

assert.notEqual(
  basicKey,
  educationKey,
  'different SPA steps at the same URL must keep separate snapshots',
);
assert.equal(
  semanticPageKey({ ...base }),
  basicKey,
  'rescanning the same semantic page must reuse its snapshot key',
);
assert.equal(
  semanticPageKey({ ...base, label: '家庭成员表格' }),
  basicKey,
  'different label sources must not split a page when the DOM signature is stable',
);

console.log('page identity tests passed');
