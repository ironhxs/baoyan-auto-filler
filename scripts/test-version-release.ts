import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
const readme = await readFile(new URL('README.md', root), 'utf8');
const english = await readFile(new URL('README.en.md', root), 'utf8');
const release = await readFile(new URL('docs/releases/v2.1.1.md', root), 'utf8');

assert.equal(pkg.version, '2.1.1');
assert.equal(lock.version, '2.1.1');
assert.equal(lock.packages[''].version, '2.1.1');
assert.match(readme, /version-2\.1\.1/u);
assert.match(readme, /先收集所有可安全访问的页面/u);
assert.match(readme, /学校 · 院系/u);
assert.match(english, /version-2\.1\.1/u);
assert.match(release, /2\.1\.1/u);
assert.match(release, /跨页/u);
assert.match(release, /动态新增记录/u);

console.log('version and release tests passed');
