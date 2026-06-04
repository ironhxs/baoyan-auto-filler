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
  createProfileExport,
  mergeProfileFields,
  normalizeProfileFields,
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
assert.equal(exported.version, 1);
assert.equal(exported.exportedAt, '2026-06-02T00:00:00.000Z');
assert.deepEqual(exported.fields, [{ key: '姓名', value: '张三' }]);
assert.match(stringifyProfileExport(exported.fields), /"fields"/);

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

console.log('profile-data tests passed');
