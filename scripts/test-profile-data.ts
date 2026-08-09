import assert from 'node:assert/strict';
import {
  appendProfileBlocks,
  appendProfileFields,
  createProfileExport,
  mergeProfileBlocks,
  mergeProfileFields,
  normalizeProfileFields,
  parseProfileImport,
  parseProfileImportBundle,
  stringifyProfileExport,
} from '../utils/profile-data';

assert.deepEqual(normalizeProfileFields([
  { key: ' 姓名 ', value: ' 张三 ' },
  { key: '', value: 'skip' },
  { key: '姓名', value: 'duplicate' },
  { key: '手机号', value: '13800138000' },
]), [
  { key: '姓名', value: '张三' },
  { key: '手机号', value: '13800138000' },
]);

const exported = createProfileExport([{ key: '姓名', value: '张三' }], new Date('2026-06-02T00:00:00.000Z'));
assert.equal(exported.schema, 'auto-filler.profile');
assert.equal(exported.version, 2);
assert.deepEqual(exported.blocks, []);
assert.match(stringifyProfileExport([{ key: '姓名', value: '张三' }]), /"fields"/);

const bundle = parseProfileImportBundle(JSON.stringify({
  schema: 'auto-filler.profile',
  version: 2,
  fields: [{ key: '姓名', value: '张三' }],
  blocks: [{ title: '家庭成员', sectionId: 'family', items: [{ fields: [{ key: '姓名', value: '张父' }] }] }],
}));
assert.equal(bundle.blocks[0].items[0].fields[0].value, '张父');
assert.deepEqual(parseProfileImport(JSON.stringify({ 姓名: '李四' })), [{ key: '姓名', value: '李四' }]);
assert.throws(() => parseProfileImport('{bad json'), /JSON 文件格式不正确/);
assert.throws(() => parseProfileImport(JSON.stringify({ fields: 'bad' })), /fields 必须是字段数组/);

assert.deepEqual(
  mergeProfileFields([{ key: '姓名', value: '张三' }, { key: '邮箱', value: 'old@example.com' }],
    [{ key: '邮箱', value: 'new@example.com' }, { key: '学校', value: '示例大学' }]),
  [{ key: '姓名', value: '张三' }, { key: '邮箱', value: 'new@example.com' }, { key: '学校', value: '示例大学' }],
);
assert.deepEqual(
  appendProfileFields([{ key: '姓名', value: '现有姓名' }],
    [{ key: '姓名', value: '导入姓名' }, { key: '学校', value: '示例大学' }]),
  [{ key: '姓名', value: '现有姓名' }, { key: '学校', value: '示例大学' }],
);
assert.equal(mergeProfileBlocks(
  [{ id: 5, title: '家庭成员', sectionId: 'family', items: [] }],
  [{ title: '家庭成员', sectionId: 'family', items: [{ fields: [{ key: '姓名', value: '张父' }] }] }],
)[0].items[0].fields[0].value, '张父');
assert.equal(appendProfileBlocks(
  [{ id: 8, title: '家庭成员', sectionId: 'family', items: [{ fields: [{ key: '姓名', value: '测试父亲' }] }] }],
  [{ title: '家庭成员', sectionId: 'family', items: [{ fields: [{ key: '姓名', value: '测试母亲' }] }] }],
)[0].items.length, 2);

console.log('profile-data tests passed');
