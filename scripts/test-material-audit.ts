import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  inspectPdfMaterial,
  isAllowedVisibleMaterialUrl,
  runFinalAudit,
} from '../utils/material-audit';
import type { ApplicationTask } from '../utils/application-tasks';

async function createEightPagePdf(): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= 8; pageNumber++) {
    const page = pdf.addPage([300, 200]);
    page.drawText(`Page ${pageNumber}`, { x: 40, y: 120, size: 20, font });
  }
  const bytes = await pdf.save();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/pdf' });
}

const inspected = await inspectPdfMaterial(await createEightPagePdf(), {
  identityDocument: false,
  renderImages: false,
});
assert.equal(inspected.pageCount, 8);
assert.deepEqual(inspected.selectedPages.map((page) => page.pageNumber), [1, 4, 8]);
assert.match(inspected.selectedPages[0].text, /Page 1/);
assert.match(inspected.selectedPages[1].text, /Page 4/);
assert.match(inspected.selectedPages[2].text, /Page 8/);

assert.equal(isAllowedVisibleMaterialUrl('https://a.example/file.pdf', 'https://a.example'), true);
assert.equal(isAllowedVisibleMaterialUrl('/file.pdf', 'https://a.example/app'), true);
assert.equal(isAllowedVisibleMaterialUrl('https://evil.example/file.pdf', 'https://a.example'), false);
assert.equal(isAllowedVisibleMaterialUrl('javascript:alert(1)', 'https://a.example'), false);

const task: ApplicationTask = {
  id: 'task-a',
  batchId: 'batch-1',
  siteOrigin: 'https://a.example',
  siteTitle: 'A 大学',
  displayName: 'A 大学',
  initialUrl: 'https://a.example/app',
  status: 'complete',
  pageCount: 1,
  filledCount: 1,
  message: '已完成',
  history: [],
  pageOrder: ['page-a'],
  pages: {
    'page-a': {
      id: 'page-a',
      key: 'page-a',
      label: '基本信息',
      url: 'https://a.example/app/basic',
      signature: 'basic',
      capturedAt: 100,
      fields: [{
        index: 0,
        fingerprint: 'name',
        label: '姓名',
        kind: 'text',
        type: 'text',
        required: true,
        currentValue: '测试同学',
        expectedValue: '测试同学',
        status: 'verified',
      }],
      materials: [],
    },
  },
  materials: [],
  createdAt: 100,
  updatedAt: 100,
  lastOpenedAt: 100,
};

const tasks = new Map([[task.id, structuredClone(task)]]);
let requestCount = 0;
const dependencies = {
  getTasks: async () => [...tasks.values()],
  saveTask: async (next: ApplicationTask) => { tasks.set(next.id, structuredClone(next)); },
  getProfileValues: async () => [{ key: '姓名', value: '测试同学' }],
  getFileRecords: async () => [],
  getApiConfig: async () => ({
    baseUrl: 'https://api.example/v1',
    apiKey: 'test-key-not-sent-to-prompt',
    model: 'test-model',
    providerId: 'test',
    apiMode: 'responses' as const,
    fastMode: false,
    aiEnhanced: true,
  }),
  requestAudit: async (_prompt: string) => {
    requestCount++;
    return {
      text: JSON.stringify({
        summary: { critical: 0, warning: 0, info: 0 },
        issues: [],
        unchecked: [],
        confirmed: [{ taskId: 'task-a', pageId: 'page-a', title: '姓名一致' }],
      }),
      usedVisuals: false,
    };
  },
  fetchMaterial: async () => { throw new Error('no material fetch expected'); },
  now: () => 200,
};

const firstRun = await runFinalAudit(['task-a'], false, dependencies);
assert.equal(firstRun.cached, false);
assert.equal(firstRun.report.confirmed[0].title, '姓名一致');
assert.equal(requestCount, 1);
assert.equal(tasks.get('task-a')?.audit?.status, 'complete');

const cachedRun = await runFinalAudit(['task-a'], false, dependencies);
assert.equal(cachedRun.cached, true);
assert.equal(requestCount, 1, 'an unchanged audit fingerprint must reuse the valid report');

dependencies.requestAudit = async () => {
  requestCount++;
  throw new Error('gateway unavailable');
};
await assert.rejects(() => runFinalAudit(['task-a'], true, dependencies), /gateway unavailable/);
assert.equal(requestCount, 2);
assert.equal(tasks.get('task-a')?.audit?.report != null, true, 'a failed re-audit must retain the previous valid report');

console.log('material audit tests passed');
