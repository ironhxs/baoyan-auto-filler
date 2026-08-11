import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../entrypoints/popup/main.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');

assert.equal(source.includes('class="fill-policy"'), false, 'popup must not render the removed fill-policy selector');
assert.equal(source.includes('function applyFillPolicy'), false, 'popup must not keep the removed fill-policy handler');
assert.equal(styles.includes('.fill-policy'), false, 'popup stylesheet must not keep removed fill-policy styles');
assert.match(styles, /\.field-label[^{]*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
assert.match(styles, /\.field-value[^{]*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
assert.match(styles, /\.field-status[^{]*\{[^}]*min-width:\s*56px;/s);
assert.match(styles, /\.material-preview-question strong[^{]*\{[^}]*min-width:\s*0;/s);

console.log('popup policy regression test passed');
