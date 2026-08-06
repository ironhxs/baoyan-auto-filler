import assert from 'node:assert/strict';
import { AiRequestQueue } from '../utils/ai-request-queue';

const queue = new AiRequestQueue(2);
let active = 0;
let peak = 0;
const started: number[] = [];

const results = await Promise.all(Array.from({ length: 5 }, (_, index) => queue.run(async () => {
  active++;
  peak = Math.max(peak, active);
  started.push(index);
  await new Promise((resolve) => setTimeout(resolve, 20));
  active--;
  return index * 2;
})));

assert.equal(peak, 2, 'AI queue must never run more than two jobs at once');
assert.deepEqual(started, [0, 1, 2, 3, 4], 'queued jobs must start in FIFO order');
assert.deepEqual(results, [0, 2, 4, 6, 8]);
assert.equal(queue.activeCount, 0);
assert.equal(queue.pendingCount, 0);

assert.throws(
  () => new AiRequestQueue(0),
  /并发限制必须大于 0/,
);

console.log('AI request queue tests passed');
