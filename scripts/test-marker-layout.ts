import assert from 'node:assert/strict';
import {
  alignRepeatableQuestionCell,
  restoreRepeatableQuestionCell,
} from '../utils/marker-layout';

function fakeCell(inlineVerticalAlign: string): HTMLElement {
  const attributes = new Map<string, string>();
  return {
    style: { verticalAlign: inlineVerticalAlign },
    hasAttribute(name: string) { return attributes.has(name); },
    getAttribute(name: string) { return attributes.get(name) ?? null; },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    removeAttribute(name: string) { attributes.delete(name); },
  } as unknown as HTMLElement;
}

const cell = fakeCell('');
alignRepeatableQuestionCell(cell);
assert.equal(cell.style.verticalAlign, 'top');
restoreRepeatableQuestionCell(cell);
assert.equal(cell.style.verticalAlign, '');

const alreadyTop = fakeCell('top');
alignRepeatableQuestionCell(alreadyTop);
restoreRepeatableQuestionCell(alreadyTop);
assert.equal(alreadyTop.style.verticalAlign, 'top');

console.log('marker layout tests passed');
