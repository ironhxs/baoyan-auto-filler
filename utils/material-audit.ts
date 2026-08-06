import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { aiRequestQueue } from './ai-request-queue';
import {
  getApplicationTasks,
  saveApplicationTask,
} from './application-tasks';
import type {
  ApplicationMaterialSnapshot,
  ApplicationTask,
  TaskAuditState,
} from './application-tasks';
import { getAllBlockCategories, getAllFileRecords, getAllTextFields } from './db';
import type { FileRecord } from './db';
import {
  buildAuditFingerprint,
  buildAuditPreflight,
  isSensitiveAuditField,
  parseFinalAuditReport,
  samplePdfPages,
} from './final-audit';
import type {
  AuditPreflight,
  FinalAuditReport,
  FinalAuditUnchecked,
} from './final-audit';
import { requestAuditModel } from './matcher';
import type { AuditModelResult, AuditVisualInput } from './matcher';
import { flattenProfileValues } from './profile-schema';
import { getApiConfig } from './storage';
import type { ApiConfig } from './storage';

const MAX_VISUAL_PAGES = 12;

export interface PdfMaterialPage {
  pageNumber: number;
  text: string;
  imageDataUrl?: string;
}

export interface PdfMaterialInspection {
  pageCount: number;
  selectedPages: PdfMaterialPage[];
  visualDegradedReason?: string;
}

export interface InspectPdfMaterialOptions {
  identityDocument: boolean;
  renderImages: boolean;
  maxRenderedPages?: number;
}

export interface CollectedAuditMaterial {
  taskId: string;
  materialId: string;
  fieldLabel: string;
  filename: string;
  source: ApplicationMaterialSnapshot['source'];
  status: ApplicationMaterialSnapshot['status'];
  pageCount?: number;
  selectedPages: Array<{ pageNumber: number; text: string }>;
  contentAvailable: boolean;
}

export interface PreparedFinalAudit {
  tasks: ApplicationTask[];
  profileValues: Array<{ key: string; value: string }>;
  materials: CollectedAuditMaterial[];
  visuals: AuditVisualInput[];
  preflight: AuditPreflight;
  fingerprint: string;
  prompt: string;
  deterministicUnchecked: FinalAuditUnchecked[];
  apiConfig: ApiConfig;
}

export interface FinalAuditRunResult {
  report: FinalAuditReport;
  preflight: AuditPreflight;
  fingerprint: string;
  cached: boolean;
  degraded: boolean;
  degradedReason?: string;
}

export interface FinalAuditDependencies {
  getTasks(): Promise<ApplicationTask[]>;
  saveTask(task: ApplicationTask): Promise<void>;
  getProfileValues(): Promise<Array<{ key: string; value: string }>>;
  getFileRecords(): Promise<FileRecord[]>;
  getApiConfig(): Promise<ApiConfig>;
  requestAudit(prompt: string, visuals: AuditVisualInput[], apiConfig: ApiConfig): Promise<AuditModelResult>;
  fetchMaterial(url: string): Promise<Blob>;
  now(): number;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function renderPdfPage(page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>['promise']>['getPage']>>): Promise<string | undefined> {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const viewport = page.getViewport({ scale: 1.25 });
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const image = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
  return bytesToDataUrl(new Uint8Array(await image.arrayBuffer()), 'image/jpeg');
}

export async function inspectPdfMaterial(
  blob: Blob,
  options: InspectPdfMaterialOptions,
): Promise<PdfMaterialInspection> {
  const loadingTask = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const selectedPageNumbers = samplePdfPages(document.numPages, options.identityDocument);
  const renderLimit = Math.max(0, options.maxRenderedPages ?? selectedPageNumbers.length);
  const selectedPages: PdfMaterialPage[] = [];
  let rendered = 0;
  try {
    for (const pageNumber of selectedPageNumbers) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => (
        item && typeof item === 'object' && 'str' in item ? [String(item.str)] : []
      )).join(' ').replace(/\s+/g, ' ').trim();
      let imageDataUrl: string | undefined;
      if (options.renderImages && rendered < renderLimit) {
        imageDataUrl = await renderPdfPage(page);
        if (imageDataUrl) rendered++;
      }
      selectedPages.push({ pageNumber, text, imageDataUrl });
    }
  } finally {
    await loadingTask.destroy();
  }
  return {
    pageCount: document.numPages,
    selectedPages,
    ...(options.renderImages && selectedPages.some((page) => !page.imageDataUrl)
      ? { visualDegradedReason: '部分 PDF 抽样页无法在当前浏览器环境中渲染为图像' }
      : {}),
  };
}

export function isAllowedVisibleMaterialUrl(url: string, siteUrlOrOrigin: string): boolean {
  try {
    const site = new URL(siteUrlOrOrigin);
    const candidate = new URL(url, site);
    return /^https?:$/.test(candidate.protocol) && candidate.origin === site.origin;
  } catch {
    return false;
  }
}

function inferMimeType(material: ApplicationMaterialSnapshot, blob?: Blob): string {
  if (blob?.type) return blob.type.toLowerCase();
  if (material.fileType) return material.fileType.toLowerCase();
  if (/\.pdf$/i.test(material.filename)) return 'application/pdf';
  if (/\.png$/i.test(material.filename)) return 'image/png';
  if (/\.jpe?g$/i.test(material.filename)) return 'image/jpeg';
  if (/\.webp$/i.test(material.filename)) return 'image/webp';
  return '';
}

function isIdentityMaterial(material: ApplicationMaterialSnapshot): boolean {
  return /身份证|证件|identity|id[ _-]?card/i.test(`${material.fieldLabel} ${material.filename}`);
}

function sanitizedTask(task: ApplicationTask) {
  return {
    id: task.id,
    displayName: task.displayName,
    siteTitle: task.siteTitle,
    status: task.status,
    pages: task.pageOrder.flatMap((pageId) => {
      const page = task.pages[pageId];
      if (!page) return [];
      return [{
        id: page.id,
        label: page.label,
        fields: page.fields.map((field) => ({
          fingerprint: field.fingerprint,
          label: field.label,
          required: field.required,
          currentValue: field.currentValue,
          expectedValue: field.expectedValue,
          status: field.status,
        })),
      }];
    }),
    materials: task.materials.map((material) => ({
      id: material.id,
      fieldLabel: material.fieldLabel,
      filename: material.filename,
      source: material.source,
      status: material.status,
      selectedPages: material.selectedPages,
    })),
  };
}

export function collectTaskAuditInput(task: ApplicationTask) {
  return sanitizedTask(task);
}

function buildPrompt(
  tasks: ApplicationTask[],
  profileValues: Array<{ key: string; value: string }>,
  materials: CollectedAuditMaterial[],
  deterministicUnchecked: FinalAuditUnchecked[],
): string {
  const payload = {
    tasks: tasks.map(collectTaskAuditInput),
    profile: profileValues,
    materials,
    knownUnchecked: deterministicUnchecked,
  };
  return `你是推免报名资料的最终核对助手。请只根据下面的结构化数据检查：网页当前值与本地资料是否一致、跨页面事实是否矛盾、必填项是否缺失、材料名称/类别/抽样页内容是否与上传题目吻合。\n\n安全规则：不要要求修改网页，不要建议自动提交；无法从抽样内容确认的项目必须放入 unchecked，不能假装已经核验。\n\n只返回一个 JSON 对象，格式严格为：\n{"summary":{"critical":0,"warning":0,"info":0},"issues":[{"severity":"critical|warning|info","taskId":"","pageId":"","fieldFingerprint":"","materialId":"","title":"","evidence":"","expected":"","actual":"","recommendation":""}],"unchecked":[{"taskId":"","pageId":"","materialId":"","title":"","reason":""}],"confirmed":[{"taskId":"","pageId":"","materialId":"","title":""}]}\n\n待核对数据：\n${JSON.stringify(payload)}`;
}

async function blobToVisual(
  blob: Blob,
  material: ApplicationMaterialSnapshot,
  pageNumber = 1,
): Promise<AuditVisualInput> {
  const mimeType = inferMimeType(material, blob) || 'application/octet-stream';
  return {
    filename: material.filename,
    mimeType,
    dataUrl: bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), mimeType),
    pageNumber,
  };
}

function defaultDependencies(): FinalAuditDependencies {
  return {
    getTasks: getApplicationTasks,
    saveTask: saveApplicationTask,
    getProfileValues: async () => {
      const [fields, blocks] = await Promise.all([getAllTextFields(), getAllBlockCategories()]);
      return flattenProfileValues(fields, blocks).map(({ key, value }) => ({ key, value }));
    },
    getFileRecords: getAllFileRecords,
    getApiConfig,
    requestAudit: (prompt, visuals, apiConfig) => (
      aiRequestQueue.run(() => requestAuditModel(apiConfig, prompt, visuals))
    ),
    fetchMaterial: async (url) => {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`材料下载失败 (${response.status})`);
      return response.blob();
    },
    now: Date.now,
  };
}

async function resolveMaterialBlob(
  task: ApplicationTask,
  material: ApplicationMaterialSnapshot,
  records: Map<number, FileRecord>,
  dependencies: FinalAuditDependencies,
): Promise<Blob | null> {
  if (material.fileRecordId != null) return records.get(material.fileRecordId)?.fileBody ?? null;
  if (material.source !== 'website' || !material.downloadUrl) return null;
  if (!isAllowedVisibleMaterialUrl(material.downloadUrl, task.siteOrigin)) return null;
  return dependencies.fetchMaterial(material.downloadUrl);
}

export async function prepareFinalAudit(
  taskIds: string[],
  dependencies: FinalAuditDependencies = defaultDependencies(),
): Promise<PreparedFinalAudit> {
  const [allTasks, rawProfileValues, fileRecords, apiConfig] = await Promise.all([
    dependencies.getTasks(),
    dependencies.getProfileValues(),
    dependencies.getFileRecords(),
    dependencies.getApiConfig(),
  ]);
  const selected = new Set(taskIds);
  const tasks = allTasks.filter((task) => selected.has(task.id) && task.status !== 'archived');
  if (tasks.length === 0) throw new Error('请至少选择一个未归档的申请任务');
  const profileValues = rawProfileValues.filter((item) => (
    item.key.trim() && !isSensitiveAuditField({ name: item.key, label: item.key })
  ));
  const records = new Map(fileRecords.flatMap((record) => record.id == null ? [] : [[record.id, record] as const]));
  const materials: CollectedAuditMaterial[] = [];
  const visuals: AuditVisualInput[] = [];
  const deterministicUnchecked: FinalAuditUnchecked[] = [];
  const preparedTasks: ApplicationTask[] = [];

  for (const task of tasks) {
    const updatedMaterials: ApplicationMaterialSnapshot[] = [];
    for (const material of task.materials) {
      let blob: Blob | null = null;
      try {
        blob = await resolveMaterialBlob(task, material, records, dependencies);
      } catch (error) {
        deterministicUnchecked.push({
          taskId: task.id,
          materialId: material.id,
          title: material.fieldLabel,
          reason: error instanceof Error ? error.message : '材料下载失败',
        });
      }
      const mimeType = inferMimeType(material, blob ?? undefined);
      let collected: CollectedAuditMaterial = {
        taskId: task.id,
        materialId: material.id,
        fieldLabel: material.fieldLabel,
        filename: material.filename,
        source: material.source,
        status: material.status,
        selectedPages: [],
        contentAvailable: false,
      };
      let selectedPages: number[] = [];
      if (blob && mimeType === 'application/pdf') {
        const visualBudget = Math.max(0, MAX_VISUAL_PAGES - visuals.length);
        const inspected = await inspectPdfMaterial(blob, {
          identityDocument: isIdentityMaterial(material),
          renderImages: apiConfig.apiMode === 'responses' && visualBudget > 0,
          maxRenderedPages: visualBudget,
        });
        selectedPages = inspected.selectedPages.map((page) => page.pageNumber);
        collected = {
          ...collected,
          pageCount: inspected.pageCount,
          selectedPages: inspected.selectedPages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
          contentAvailable: inspected.selectedPages.some((page) => Boolean(page.text || page.imageDataUrl)),
        };
        for (const page of inspected.selectedPages) {
          if (page.imageDataUrl && visuals.length < MAX_VISUAL_PAGES) {
            visuals.push({
              filename: material.filename,
              mimeType: 'image/jpeg',
              dataUrl: page.imageDataUrl,
              pageNumber: page.pageNumber,
            });
          } else if (!page.text) {
            deterministicUnchecked.push({
              taskId: task.id,
              materialId: material.id,
              title: `${material.fieldLabel} 第 ${page.pageNumber} 页`,
              reason: visuals.length >= MAX_VISUAL_PAGES ? 'visual_page_limit' : '页面无可提取文本且无法渲染图像',
            });
          }
        }
      } else if (blob && /^image\/(?:png|jpeg|webp)$/.test(mimeType)) {
        selectedPages = [1];
        collected = { ...collected, selectedPages: [{ pageNumber: 1, text: '' }], contentAvailable: true };
        if (apiConfig.apiMode === 'responses' && visuals.length < MAX_VISUAL_PAGES) {
          visuals.push(await blobToVisual(blob, material));
        } else {
          deterministicUnchecked.push({
            taskId: task.id,
            materialId: material.id,
            title: material.fieldLabel,
            reason: visuals.length >= MAX_VISUAL_PAGES ? 'visual_page_limit' : '当前 API 模式不支持图像核验',
          });
        }
      } else if (!blob) {
        deterministicUnchecked.push({
          taskId: task.id,
          materialId: material.id,
          title: material.fieldLabel,
          reason: '无法取得材料内容，仅检查文件名和状态',
        });
      } else {
        deterministicUnchecked.push({
          taskId: task.id,
          materialId: material.id,
          title: material.fieldLabel,
          reason: '当前仅支持 PDF、JPEG、PNG 和 WebP 材料内容核验',
        });
      }
      materials.push(collected);
      updatedMaterials.push({ ...material, selectedPages });
    }
    preparedTasks.push({ ...task, materials: updatedMaterials });
  }

  const preflight = buildAuditPreflight(preparedTasks, preparedTasks.map((task) => task.id));
  preflight.notices = [...preflight.notices, ...deterministicUnchecked.map((item) => `${item.title || '材料'}：${item.reason}`)];
  const fingerprintInput = {
    protocolVersion: 1,
    tasks: preparedTasks.map(collectTaskAuditInput),
    profileValues,
    materials,
    api: { mode: apiConfig.apiMode, model: apiConfig.model },
  };
  const fingerprint = buildAuditFingerprint(fingerprintInput);
  return {
    tasks: preparedTasks,
    profileValues,
    materials,
    visuals,
    preflight,
    fingerprint,
    prompt: buildPrompt(preparedTasks, profileValues, materials, deterministicUnchecked),
    deterministicUnchecked,
    apiConfig,
  };
}

function reportFromCachedState(state: TaskAuditState | undefined, fingerprint: string): FinalAuditReport | null {
  if (state?.status !== 'complete' || state.fingerprint !== fingerprint || !state.report) return null;
  try {
    return parseFinalAuditReport(JSON.stringify(state.report));
  } catch {
    return null;
  }
}

function mergeUnchecked(report: FinalAuditReport, extra: FinalAuditUnchecked[]): FinalAuditReport {
  const key = (item: FinalAuditUnchecked) => [item.taskId, item.pageId, item.materialId, item.title, item.reason].join('|');
  const unchecked = new Map(report.unchecked.map((item) => [key(item), item]));
  for (const item of extra) unchecked.set(key(item), item);
  return { ...report, unchecked: [...unchecked.values()] };
}

export async function runFinalAudit(
  taskIds: string[],
  force: boolean,
  dependencies: FinalAuditDependencies = defaultDependencies(),
): Promise<FinalAuditRunResult> {
  const prepared = await prepareFinalAudit(taskIds, dependencies);
  if (!force) {
    for (const task of prepared.tasks) {
      const report = reportFromCachedState(task.audit, prepared.fingerprint);
      if (report) {
        return {
          report,
          preflight: prepared.preflight,
          fingerprint: prepared.fingerprint,
          cached: true,
          degraded: Boolean(task.audit?.degraded),
        };
      }
    }
  }

  const previousAuditByTask = new Map(prepared.tasks.map((task) => [task.id, task.audit]));
  const runningAt = dependencies.now();
  await Promise.all(prepared.tasks.map((task) => dependencies.saveTask({
    ...task,
    audit: { fingerprint: prepared.fingerprint, status: 'running', updatedAt: runningAt },
  })));

  try {
    const modelResult = await dependencies.requestAudit(prepared.prompt, prepared.visuals, prepared.apiConfig);
    let report = parseFinalAuditReport(modelResult.text);
    const degradationUnchecked = !modelResult.usedVisuals && prepared.visuals.length > 0
      ? prepared.visuals.map((visual): FinalAuditUnchecked => ({
        title: `${visual.filename} 第 ${visual.pageNumber} 页`,
        reason: modelResult.degradedReason || '模型线路未完成图像核验',
      }))
      : [];
    report = mergeUnchecked(report, [...prepared.deterministicUnchecked, ...degradationUnchecked]);
    const completedAt = dependencies.now();
    const state: TaskAuditState = {
      fingerprint: prepared.fingerprint,
      status: 'complete',
      report,
      rawText: modelResult.text,
      degraded: Boolean(modelResult.degradedReason || degradationUnchecked.length),
      updatedAt: completedAt,
    };
    await Promise.all(prepared.tasks.map((task) => dependencies.saveTask({ ...task, audit: state })));
    return {
      report,
      preflight: prepared.preflight,
      fingerprint: prepared.fingerprint,
      cached: false,
      degraded: Boolean(state.degraded),
      degradedReason: modelResult.degradedReason,
    };
  } catch (error) {
    const failedAt = dependencies.now();
    await Promise.all(prepared.tasks.map((task) => {
      const previous = previousAuditByTask.get(task.id);
      return dependencies.saveTask({
        ...task,
        audit: {
          ...previous,
          fingerprint: prepared.fingerprint,
          status: 'error',
          error: error instanceof Error ? error.message : '最终检查失败',
          updatedAt: failedAt,
        },
      });
    }));
    throw error;
  }
}
