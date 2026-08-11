import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const popup = await readFile(new URL('../entrypoints/popup/main.ts', import.meta.url), 'utf8');
const audit = await readFile(new URL('../entrypoints/audit/main.ts', import.meta.url), 'utf8');
const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');

for (const source of [popup, audit]) {
  assert.match(source, /renameApplicationTask/u);
  assert.match(source, /restoreAutomaticTaskName/u);
  assert.match(source, /恢复自动名称/u);
}
assert.match(background, /request\.type === 'renameApplicationTask'/u);
assert.match(background, /request\.type === 'restoreAutomaticTaskName'/u);

console.log('task naming UI tests passed');
