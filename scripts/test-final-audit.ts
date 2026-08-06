import assert from 'node:assert/strict';
import {
  buildAuditFingerprint,
  buildAuditPreflight,
  buildPageSnapshot,
  isSensitiveAuditField,
  parseFinalAuditReport,
  samplePdfPages,
} from '../utils/final-audit';
import type { ApplicationTask } from '../utils/application-tasks';
import type { FormFieldInfo, MatchResult } from '../utils/matcher';

function field(partial: Partial<FormFieldInfo>): FormFieldInfo {
  return {
    index: 0,
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    label: '',
    placeholder: '',
    ariaLabel: '',
    context: '',
    ...partial,
  };
}

assert.equal(isSensitiveAuditField(field({ type: 'password', name: 'password' })), true);
assert.equal(isSensitiveAuditField(field({ type: 'hidden', name: '_csrf' })), true);
assert.equal(isSensitiveAuditField(field({ type: 'text', name: 'captchaToken', label: '内部值' })), true);
assert.equal(isSensitiveAuditField(field({ type: 'text', name: 'idCard', label: '身份证号码' })), false);

assert.deepEqual(samplePdfPages(0, false), []);
assert.deepEqual(samplePdfPages(1, false), [1]);
assert.deepEqual(samplePdfPages(2, true), [1, 2]);
assert.deepEqual(samplePdfPages(8, false), [1, 4, 8]);

const fields: FormFieldInfo[] = [
  field({ index: 0, name: 'realName', label: '姓名', value: '贺同学', required: true }),
  field({ index: 1, name: 'phone', label: '联系电话', value: '错误号码', required: true }),
  field({ index: 2, type: 'hidden', name: '_csrf', value: 'secret-token' }),
  field({ index: 3, type: 'password', name: 'password', label: '密码', value: 'secret' }),
  field({ index: 4, name: 'remark', label: '备注', value: '', protected: true, protectionReason: '需本人处理' }),
];
const matches: MatchResult[] = [
  { index: 0, fieldKey: '姓名', value: '贺同学', shortLabel: '姓名', confidence: 'high', source: 'local' },
  { index: 1, fieldKey: '手机号', value: '13800000000', shortLabel: '电话', confidence: 'high', source: 'ai_reviewed' },
];

const snapshot = buildPageSnapshot({
  pageKey: 'https://a.example/app/basic',
  pageLabel: '基本信息',
  pageUrl: 'https://a.example/app/basic#step',
  pageSignature: 'signature-a',
  capturedAt: 500,
  fields,
  matches,
  websiteMaterials: [{
    url: 'https://a.example/files/transcript.pdf',
    filename: '已上传成绩单.pdf',
    label: '本科成绩单',
  }],
});
assert.equal(snapshot.fields.length, 3, 'hidden security and password fields must be removed');
assert.deepEqual(snapshot.fields.map((item) => item.label), ['姓名', '联系电话', '备注']);
assert.equal(snapshot.fields[0].status, 'verified');
assert.equal(snapshot.fields[1].status, 'mismatch');
assert.equal(snapshot.fields[2].status, 'protected');
assert.equal(snapshot.fields[1].expectedValue, '13800000000');
assert.equal(JSON.stringify(snapshot).includes('secret-token'), false);
assert.equal(snapshot.materials.length, 1);
assert.equal(snapshot.materials[0].source, 'website');
assert.equal(snapshot.materials[0].downloadUrl, 'https://a.example/files/transcript.pdf');
assert.equal(snapshot.materials[0].fieldLabel, '本科成绩单');

const task: ApplicationTask = {
  id: 'task-a',
  batchId: 'batch-1',
  siteOrigin: 'https://a.example',
  siteTitle: 'A 大学',
  displayName: 'A 大学',
  initialUrl: snapshot.url,
  status: 'complete',
  pageCount: 1,
  filledCount: 2,
  message: '已到最终审核页',
  history: [],
  pageOrder: [snapshot.id],
  pages: { [snapshot.id]: snapshot },
  materials: [{
    id: 'material-a',
    fieldFingerprint: 'file::transcript',
    fieldLabel: '成绩单',
    source: 'local',
    filename: '成绩单.pdf',
    fileType: 'application/pdf',
    fileSize: 1000,
    selectedPages: [1, 4, 8],
    status: 'uploaded',
  }],
  createdAt: 100,
  updatedAt: 500,
  lastOpenedAt: 500,
};

const preflight = buildAuditPreflight([task], ['task-a']);
assert.deepEqual(preflight, {
  taskCount: 1,
  pageCount: 1,
  fieldCount: 3,
  materialCount: 1,
  sampledPageCount: 3,
  notices: [],
});

const fingerprintInput = {
  tasks: [task],
  profile: [{ key: '姓名', value: '贺同学' }],
  api: { mode: 'responses', model: 'test-model', protocolVersion: 1 },
};
const reorderedFingerprintInput = {
  api: { protocolVersion: 1, model: 'test-model', mode: 'responses' },
  profile: [{ value: '贺同学', key: '姓名' }],
  tasks: [task],
};
assert.equal(buildAuditFingerprint(fingerprintInput), buildAuditFingerprint(reorderedFingerprintInput));
assert.notEqual(
  buildAuditFingerprint(fingerprintInput),
  buildAuditFingerprint({ ...fingerprintInput, profile: [{ key: '姓名', value: '另一姓名' }] }),
);

const report = parseFinalAuditReport(`\`\`\`json
{
  "summary": { "critical": 0, "warning": 1, "info": 0 },
  "issues": [{
    "severity": "warning",
    "taskId": "task-a",
    "pageId": "page-basic",
    "title": "联系电话不一致",
    "evidence": "网页值与资料不同",
    "expected": "13800000000",
    "actual": "错误号码",
    "recommendation": "人工核对"
  }],
  "unchecked": [],
  "confirmed": []
}
\`\`\``);
assert.equal(report.summary.warning, 1);
assert.equal(report.issues[0].severity, 'warning');
assert.equal(report.issues[0].title, '联系电话不一致');
assert.throws(() => parseFinalAuditReport('{"summary":{},"issues":"wrong"}'), /审核报告格式无效/);

console.log('final audit core tests passed');
