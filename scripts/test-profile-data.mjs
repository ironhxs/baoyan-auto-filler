import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import ts from 'typescript';

const source = readFileSync(new URL('../utils/profile-data.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});

const mod = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const {
  appendProfileFields,
  appendProfileBlocks,
  createProfileExport,
  mergeProfileFields,
  mergeProfileBlocks,
  normalizeProfileFields,
  parseProfileImportBundle,
  parseProfileImport,
  stringifyProfileExport,
} = mod;

const normalized = normalizeProfileFields([
  { key: ' 姓名 ', value: ' 张三 ' },
  { key: '', value: 'skip' },
  { key: '姓名', value: 'duplicate' },
  { key: '手机号', value: 13800138000 },
]);
assert.deepEqual(normalized, [
  { key: '姓名', value: '张三' },
  { key: '手机号', value: '13800138000' },
]);

const exported = createProfileExport(
  [{ key: '姓名', value: '张三' }],
  new Date('2026-06-02T00:00:00.000Z'),
);
assert.equal(exported.schema, 'auto-filler.profile');
assert.equal(exported.version, 2);
assert.equal(exported.exportedAt, '2026-06-02T00:00:00.000Z');
assert.deepEqual(exported.fields, [{ key: '姓名', value: '张三' }]);
assert.deepEqual(exported.blocks, []);
assert.match(stringifyProfileExport(exported.fields), /"fields"/);

const bundle = parseProfileImportBundle(JSON.stringify({
  schema: 'auto-filler.profile',
  version: 2,
  fields: [{ key: '姓名', value: '张三' }],
  blocks: [{
    title: '家庭成员',
    sectionId: 'family',
    templateFields: ['姓名', '关系'],
    items: [{ fields: [{ key: '姓名', value: '张父' }, { key: '关系', value: '父亲' }] }],
  }],
}));
assert.equal(bundle.blocks[0].items[0].fields[0].value, '张父');
assert.deepEqual(
  parseProfileImportBundle(JSON.stringify({
    schema: 'auto-filler.profile',
    version: 1,
    fields: [{ key: '邮箱', value: 'old@example.com' }],
  })).fields,
  [{ key: '邮箱', value: 'old@example.com' }],
);

assert.deepEqual(
  parseProfileImport(JSON.stringify({ fields: [{ key: '邮箱', value: 'me@example.com' }] })),
  [{ key: '邮箱', value: 'me@example.com' }],
);
assert.deepEqual(
  parseProfileImport(JSON.stringify([{ key: '学校', value: '示例大学' }])),
  [{ key: '学校', value: '示例大学' }],
);
assert.deepEqual(
  parseProfileImport(JSON.stringify({ 姓名: '李四', 年级: 2026 })),
  [
    { key: '姓名', value: '李四' },
    { key: '年级', value: '2026' },
  ],
);
assert.throws(() => parseProfileImport('{bad json'), /JSON 文件格式不正确/);
assert.throws(() => parseProfileImport(JSON.stringify({ fields: 'bad' })), /fields 必须是字段数组/);

assert.deepEqual(
  mergeProfileFields(
    [
      { key: '姓名', value: '张三' },
      { key: '邮箱', value: 'old@example.com' },
    ],
    [
      { key: '邮箱', value: 'new@example.com' },
      { key: '学校', value: '示例大学' },
    ],
  ),
  [
    { key: '姓名', value: '张三' },
    { key: '邮箱', value: 'new@example.com' },
    { key: '学校', value: '示例大学' },
  ],
);

assert.deepEqual(
  appendProfileFields(
    [{ key: '姓名', value: '现有姓名' }],
    [
      { key: '姓名', value: '导入姓名' },
      { key: '学校', value: '示例大学' },
    ],
  ),
  [
    { key: '姓名', value: '现有姓名' },
    { key: '学校', value: '示例大学' },
  ],
);

assert.deepEqual(
  mergeProfileBlocks(
    [{ id: 5, title: '家庭成员', sectionId: 'family', items: [] }],
    [{
      title: '家庭成员',
      sectionId: 'family',
      items: [{ fields: [{ key: '姓名', value: '张父' }] }],
    }],
  ),
  [{
    id: 5,
    title: '家庭成员',
    sectionId: 'family',
    items: [{ fields: [{ key: '姓名', value: '张父' }] }],
  }],
);

assert.deepEqual(
  appendProfileBlocks(
    [{
      id: 8,
      title: '家庭成员',
      sectionId: 'family',
      templateFields: ['姓名', '关系'],
      items: [{ fields: [{ key: '姓名', value: '测试父亲' }, { key: '关系', value: '父亲' }] }],
    }],
    [{
      title: '家庭成员',
      sectionId: 'family',
      templateFields: ['姓名', '联系电话'],
      items: [
        { fields: [{ key: '关系', value: '父亲' }, { key: '姓名', value: '测试父亲' }] },
        { fields: [{ key: '姓名', value: '测试母亲' }, { key: '关系', value: '母亲' }] },
      ],
    }],
  ),
  [{
    id: 8,
    title: '家庭成员',
    sectionId: 'family',
    templateFields: ['姓名', '关系', '联系电话'],
    items: [
      { fields: [{ key: '姓名', value: '测试父亲' }, { key: '关系', value: '父亲' }] },
      { fields: [{ key: '姓名', value: '测试母亲' }, { key: '关系', value: '母亲' }] },
    ],
  }],
);

console.log('profile-data tests passed');
