import { getApiConfig, isApiConfigured, setApiConfig } from '@/utils/storage';
import {
  getAllCategories,
  getAllBlockCategories,
  getAllFileRecords,
  getAllTextFields,
  saveAllTextFields,
} from '@/utils/db';
import { matchFields, requestModelText } from '@/utils/matcher';
import type { Category, FileRecord } from '@/utils/db';
import type { MatchResult, FormFieldInfo, MaterialRole, ModelRequestOptions } from '@/utils/matcher';
import { flattenProfileValues } from '@/utils/profile-schema';
import {
  adaptValueToField,
  getAiEligibleFields,
  isMeaningfullyFilled,
  matchFieldsLocally,
  mergeLocalAndAiMatches,
} from '@/utils/local-matcher';
import { isPageValueConsistent } from '@/utils/value-compare';
import { fieldFingerprint } from '@/utils/field-fingerprint';
import { materialFieldDisplayLabel, materialFieldRoleTexts } from '@/utils/material-field-context';
import { aiRequestQueue } from '@/utils/ai-request-queue';
import {
  APPLICATION_TASK_BINDINGS_KEY,
  archiveApplicationTask,
  bindTaskToTab,
  canResumeRunner,
  createApplicationBatchId,
  createApplicationTask,
  createApplicationTaskId,
  getApplicationTask,
  getApplicationTasks,
  saveApplicationTask,
  unbindTaskFromTab,
  updateApplicationTask,
  updateTaskRunnerCheckpoint,
  updateTaskFromAutoRun,
  updateTaskApplicationIdentity,
  upsertTaskPage,
  upsertTaskPageAnalysis,
} from '@/utils/application-tasks';
import type {
  ApplicationTask,
  ApplicationTaskBindings,
  ApplicationTaskPauseReason,
} from '@/utils/application-tasks';
import type { ApplicationRunnerCheckpoint } from '@/utils/page-analysis';
import { buildPageSnapshot } from '@/utils/final-audit';
import type { WebsiteMaterialCandidate } from '@/utils/final-audit';
import { prepareFinalAudit, runFinalAudit } from '@/utils/material-audit';
import type { AuditPreflight, FinalAuditReport } from '@/utils/final-audit';
import { canonicalPageUrl, semanticPageKey } from '@/utils/page-identity';
import {
  derivePageMarkers,
  enqueueSerializedRestore,
  isCurrentRestoreGeneration,
  shouldRestoreLegacyMarkers,
  shouldReusePageAnalysis,
} from '@/utils/page-analysis';
import type { ApplicationPageAnalysis, CachedAnalysisRestoreResult } from '@/utils/page-analysis';
import {
  buildRepeatDialogTargetSchemas,
  buildRepeatDialogTargets,
  planRepeatableRecords,
  prepareRepeatableRowScan,
  runSequentialRepeatPreparationPasses,
  sameRepeatableGroupLabel,
  type PrepareRepeatRecordsResult,
  type CommitRepeatRecordResult,
  type RepeatableRecordPlan,
  type PrepareRepeatRowsResult,
  type RepeatableGroupObservation,
} from '@/utils/repeatable-records';
import { buildAgentPageSnapshot } from '@/utils/agent/page-snapshot';
import { inferAgentApplicationIdentityFromPage } from '@/utils/agent/page-identity';
import { buildAgentPreview } from '@/utils/agent/preview';
import { retrieveAgentSourceRecords } from '@/utils/agent/profile-retriever';
import {
  completeRepeatDialogRecordWithAgent,
  requestAgentPagePlan,
} from '@/utils/agent/planner';
import { sanitizeAgentSourceRecords } from '@/utils/agent/batch-prompt';
import { requestAgentBatchPlan } from '@/utils/agent/batch-planner';
import { findReusableAgentBatchPagePlan, mergeAgentBatchPages, refreshAgentBatchPage } from '@/utils/agent/batch-state';
import { coordinateAgentBatchPlanning } from '@/utils/agent/batch-coordinator';
import type { AgentBatchBlueprint, AgentBatchPageInput, AgentBatchPlan } from '@/utils/agent/batch-types';
import {
  AGENT_PROTOCOL_VERSION,
  createAgentPlanCacheKey,
  getAgentPlanCache,
  saveAgentPlanCache,
} from '@/utils/agent/cache';
import { blockingAgentReviewItems, canAgentAdvance, validateAgentPlan } from '@/utils/agent/policy';
import { buildAgentExecutionBatch } from '@/utils/agent/executor';
import type { AgentExecutionResult } from '@/utils/agent/executor';
import { decideRepeatRecordCommit } from '@/utils/agent/repeat-commit-policy';
import { verifyAgentExecution } from '@/utils/agent/verifier';
import { runAgentPage } from '@/utils/agent/runtime';
import { agentCheckpointForPage, applyAgentControl } from '@/utils/agent/control';
import type { AgentControlCommand } from '@/utils/agent/control';
import { shouldPreferPageAgent } from '@/utils/agent/activation';
import { requestAgentModelThroughBridge } from '@/utils/agent/model-bridge';
import { accountAgentRun } from '@/utils/agent/run-accounting';
import type {
  AgentActionResult,
  AgentCheckpoint,
  AgentPageSemanticContext,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedAction,
} from '@/utils/agent/types';

type PageMarkerStatus = 'verified' | 'review' | 'mismatch';
interface PageMarkerItem {
  index: number;
  fingerprint?: string;
  status: PageMarkerStatus;
  message?: string;
}

interface MessageMap {
  inspectPage: undefined;
  startScan: undefined;
  startFill: { matches: MatchResult[] };
  manualFill: { value: string };
  markPageFields: {
    items: PageMarkerItem[];
  };
  focusPageField: { index: number };
  focusAgentTarget: { pageKey: string; targetId: string };
  controlPageAgent: { command: AgentControlCommand };
  startAutoRun: undefined;
  getAutoRunStatus: undefined;
  stopAutoRun: undefined;
  confirmMaterialsAndResume: undefined;
  previewExistingMaterial: { index: number };
  getCurrentApplicationTask: undefined;
  getCurrentPageAnalysis: undefined;
  savePageAnalysis: {
    scan: ScanSuccessResponse;
    markers: PageMarkerItem[];
    checkedIndexes: number[];
    repeatPlan: RepeatableRecordPlan;
  };
  listApplicationTasks: undefined;
  archiveApplicationTask: { taskId: string };
  openAuditCenter: undefined;
  getAuditPreflight: { taskIds: string[] };
  runFinalAudit: { taskIds: string[]; force: boolean; confirmed: boolean };
  focusApplicationTask: { taskId: string };
}

type MessageType = keyof MessageMap;

type Request = {
  [T in MessageType]: {
    type: T;
    payload: MessageMap[T];
  };
}[MessageType];

interface ErrorResponse {
  ok: false;
  error: string;
}

interface ScanSuccessResponse {
  ok: true;
  type: 'scan';
  total: number;
  matched: number;
  matches: MatchResult[];
  fields: FormFieldInfo[];
  pageLabel: string;
  pageUrl: string;
  pageSignature: string;
  applicationTitle?: string;
  stepText?: string;
  visibleTexts?: string[];
  instructions?: string[];
  repeatRowPreparation: PrepareRepeatRowsResult;
  repeatPlan: RepeatableRecordPlan;
  repeatGroups?: RepeatableGroupObservation[];
  ai: {
    configured: boolean;
    mode: 'enhanced' | 'fallback';
    attempted: boolean;
    cached: boolean;
    reviewed: number;
    error: string;
    agent?: boolean;
    pendingActions?: number;
    reviewItems?: number;
  };
}

interface FillSuccessResponse {
  ok: true;
  type: 'fill';
  success: number;
  failure: number;
}

interface InspectSuccessResponse {
  ok: true;
  type: 'inspect';
  total: number;
  required: number;
  unfilled: number;
  protected: number;
}

interface PageActionSuccessResponse {
  ok: true;
  type: 'pageAction';
}

interface ExistingMaterialPreviewSuccessResponse {
  ok: true;
  type: 'existingMaterialPreview';
  dataUrl: string;
  mimeType: string;
  evidence: string;
}

type AutoRunStatus = 'running' | 'paused' | 'complete' | 'stopped';

interface AutoRunHistoryEntry {
  page: number;
  pageKey: string;
  label: string;
  recognized: number;
  matched: number;
  verified: number;
  conflicts: number;
  filled: number;
  aiAttempted: boolean;
  aiCached: boolean;
  aiReviewed: number;
  status: 'checked' | 'paused' | 'complete' | 'error';
  message: string;
  updatedAt: number;
}

interface AutoRunState {
  tabId: number;
  taskId?: string;
  batchId?: string;
  status: AutoRunStatus;
  pageCount: number;
  filledCount: number;
  message: string;
  updatedAt: number;
  history: AutoRunHistoryEntry[];
  pauseReason?: 'materials' | 'required' | 'navigation' | 'page' | 'error';
  confirmedMaterialPageKey?: string;
  lastPageKey?: string;
  agent?: AgentCheckpoint;
  batchPhase?: 'collecting' | 'planning' | 'executing' | 'review';
  batchBlueprint?: AgentBatchBlueprint;
  batchPlan?: AgentBatchPlan;
}

interface AutoRunSuccessResponse extends AutoRunState {
  ok: true;
  type: 'autoRun';
}

interface ApplicationTaskSuccessResponse {
  ok: true;
  type: 'applicationTask';
  currentTaskId?: string;
  task: ApplicationTask | null;
}

interface PageAnalysisSuccessResponse {
  ok: true;
  type: 'pageAnalysis';
  analysis: ApplicationPageAnalysis | null;
  currentPageKey: string;
}

interface ApplicationTaskListSuccessResponse {
  ok: true;
  type: 'applicationTasks';
  currentTaskId?: string;
  tasks: ApplicationTask[];
}

interface AuditPreflightSuccessResponse {
  ok: true;
  type: 'auditPreflight';
  preflight: AuditPreflight;
  fingerprint: string;
}

interface FinalAuditSuccessResponse {
  ok: true;
  type: 'finalAudit';
  report: FinalAuditReport;
  preflight: AuditPreflight;
  fingerprint: string;
  cached: boolean;
  degraded: boolean;
  degradedReason?: string;
}

type Response = ScanSuccessResponse | FillSuccessResponse | InspectSuccessResponse | PageActionSuccessResponse | ExistingMaterialPreviewSuccessResponse | AutoRunSuccessResponse | ApplicationTaskSuccessResponse | PageAnalysisSuccessResponse | ApplicationTaskListSuccessResponse | AuditPreflightSuccessResponse | FinalAuditSuccessResponse | ErrorResponse;

type ContentFillItem =
  | { kind: 'text'; index: number; value: string; confidence: MatchResult['confidence'] }
  | { kind: 'file'; index: number; fileName: string; fileType: string; fileBody: string };

interface RoleScore {
  role: MaterialRole;
  score: number;
  exact: boolean;
}

const autoRunInFlight = new Set<number>();
const pageRestoreGenerations = new Map<number, number>();
const pageRestoreTails = new Map<number, Promise<void>>();
const AI_MATCH_CACHE_TTL_MS = 5 * 60 * 1000;
const AI_MATCH_CACHE_LIMIT = 40;

const AGENT_OFFSCREEN_PATH = 'offscreen.html';
let creatingAgentOffscreen: Promise<void> | null = null;

function supportsAgentOffscreen(): boolean {
  return typeof (chrome as any).offscreen?.createDocument === 'function';
}

async function ensureAgentOffscreen(): Promise<void> {
  if (!supportsAgentOffscreen()) return;
  const documentUrl = chrome.runtime.getURL(AGENT_OFFSCREEN_PATH);
  const runtime = chrome.runtime as any;
  if (typeof runtime.getContexts === 'function') {
    const contexts = await runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [documentUrl],
    });
    if (contexts.length > 0) return;
  }
  if (creatingAgentOffscreen) return creatingAgentOffscreen;
  creatingAgentOffscreen = (chrome as any).offscreen.createDocument({
    url: AGENT_OFFSCREEN_PATH,
    reasons: ['WORKERS'],
    justification: 'Run user-initiated Agent model requests without MV3 service-worker interruption',
  });
  try {
    await creatingAgentOffscreen;
  } finally {
    creatingAgentOffscreen = null;
  }
}

async function requestAgentModelDurably(
  apiConfig: Awaited<ReturnType<typeof getApiConfig>>,
  prompt: string,
  options: ModelRequestOptions = {},
): Promise<string> {
  return requestAgentModelThroughBridge(apiConfig, prompt, options, {
    supportsOffscreen: supportsAgentOffscreen(),
    ensureOffscreen: ensureAgentOffscreen,
    sendToOffscreen: (message) => chrome.runtime.sendMessage(message),
    directRequest: requestModelText,
  });
}
const aiMatchCache = new Map<string, { expiresAt: number; matches: MatchResult[] }>();

function shortStableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function getCachedAiMatches(key: string): MatchResult[] | null {
  const cached = aiMatchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    aiMatchCache.delete(key);
    return null;
  }
  return cached.matches.map((match) => ({ ...match }));
}

function cacheAiMatches(key: string, matches: MatchResult[]): void {
  const now = Date.now();
  for (const [cacheKey, cached] of aiMatchCache) {
    if (cached.expiresAt <= now) aiMatchCache.delete(cacheKey);
  }
  while (aiMatchCache.size >= AI_MATCH_CACHE_LIMIT) {
    const oldest = aiMatchCache.keys().next().value as string | undefined;
    if (!oldest) break;
    aiMatchCache.delete(oldest);
  }
  aiMatchCache.set(key, {
    expiresAt: now + AI_MATCH_CACHE_TTL_MS,
    matches: matches.map((match) => ({ ...match })),
  });
}

const MATERIAL_LABELS: Record<MaterialRole, string> = {
  application_form: '申请表',
  id_card: '身份证件',
  id_photo: '证件照',
  id_card_front: '身份证正面',
  id_card_back: '身份证反面',
  transcript: '成绩单',
  ranking_proof: '排名证明',
  cet4_certificate: '四级成绩证明',
  cet6_certificate: '六级成绩证明',
  language_certificate: '外语成绩证明',
  award_certificate: '获奖证明',
  academic_proof: '学术成果证明',
  practice_proof: '实践经历证明',
  student_card: '学生证',
  recommendation_letter: '推荐信',
  mentor_consent: '导师同意证明',
  enrollment_certificate: '在读证明',
  resume: '个人简历',
};

const ROLE_KEYWORDS: Record<MaterialRole, { exact: string[]; alias: string[] }> = {
  application_form: {
    exact: ['推免生申请表', '推荐免试研究生申请表', '报名申请表', '申请表'],
    alias: ['申请材料表', '报名表'],
  },
  id_card: {
    exact: ['身份证正反面', '身份证扫描件', '身份证件', '有效居民身份证'],
    alias: ['身份证'],
  },
  id_photo: {
    exact: ['证件照', '免冠照片', '免冠照', '个人照片', '报名照片'],
    alias: ['照片', '头像'],
  },
  id_card_front: {
    exact: ['身份证正面', '身份证人像面', '身份证头像面'],
    alias: ['人像面', '正面'],
  },
  id_card_back: {
    exact: ['身份证反面', '身份证国徽面'],
    alias: ['国徽面', '反面'],
  },
  transcript: {
    exact: ['本科成绩单', '成绩单', '学业成绩单'],
    alias: ['成绩证明', '学业成绩'],
  },
  ranking_proof: {
    exact: ['专业排名证明', '成绩排名证明', '排名证明'],
    alias: ['排名', '专业名次', '年级名次'],
  },
  cet4_certificate: {
    exact: ['英语四级成绩单', '四级成绩单', '英语四级证书', 'CET-4成绩单', 'CET4成绩单'],
    alias: ['英语四级', 'CET-4', 'CET4', '四级'],
  },
  cet6_certificate: {
    exact: ['英语六级成绩单', '六级成绩单', '英语六级证书', 'CET-6成绩单', 'CET6成绩单'],
    alias: ['英语六级', 'CET-6', 'CET6', '六级'],
  },
  language_certificate: {
    exact: ['外语成绩证明', '外语水平证明', '英语成绩证明', '雅思成绩单', '托福成绩单'],
    alias: ['外语', '英语成绩', '雅思', '托福'],
  },
  award_certificate: {
    exact: ['获奖证书', '奖励证明', '荣誉证书', '竞赛证书'],
    alias: ['获奖', '奖励', '荣誉', '竞赛'],
  },
  academic_proof: {
    exact: ['学术成果证明', '科研成果证明', '论文证明', '专利证书'],
    alias: ['论文', '专利', '科研成果', '学术成果'],
  },
  practice_proof: {
    exact: ['实践经历证明', '实习证明', '科研训练证明', '社会工作证明'],
    alias: ['实践经历', '实习实践', '科研训练', '社会工作'],
  },
  student_card: {
    exact: ['学生证', '学生证件'],
    alias: ['学生身份'],
  },
  recommendation_letter: {
    exact: ['专家推荐信', '专家推荐书', '推荐信'],
    alias: ['推荐材料', '推荐书'],
  },
  mentor_consent: {
    exact: ['导师同意报名证明', '导师同意证明', '导师接收证明'],
    alias: ['导师同意', '导师接收'],
  },
  enrollment_certificate: {
    exact: ['在读证明', '学籍证明', '在校证明'],
    alias: ['在读', '学籍', '在校'],
  },
  resume: {
    exact: ['个人简历', '申请简历'],
    alias: ['简历', 'CV'],
  },
};

function errorResponse(error: string): ErrorResponse {
  return { ok: false, error };
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getTaskBindings(): Promise<ApplicationTaskBindings> {
  const result = await chrome.storage.session.get(APPLICATION_TASK_BINDINGS_KEY);
  const stored = result[APPLICATION_TASK_BINDINGS_KEY];
  return stored && typeof stored === 'object' ? stored as ApplicationTaskBindings : {};
}

async function getBoundTaskId(tabId: number): Promise<string | undefined> {
  return (await getTaskBindings())[String(tabId)];
}

async function setTaskBinding(tabId: number, taskId: string): Promise<void> {
  const next = bindTaskToTab(await getTaskBindings(), tabId, taskId);
  await chrome.storage.session.set({ [APPLICATION_TASK_BINDINGS_KEY]: next });
}

async function removeTaskBinding(tabId: number): Promise<void> {
  const next = unbindTaskFromTab(await getTaskBindings(), tabId);
  await chrome.storage.session.set({ [APPLICATION_TASK_BINDINGS_KEY]: next });
}

function siteIdentity(tab: chrome.tabs.Tab): { origin: string; title: string; url: string } {
  const url = tab.url ?? '';
  try {
    const parsed = new URL(url);
    return {
      origin: parsed.origin,
      title: tab.title?.trim() || parsed.hostname,
      url,
    };
  } catch {
    return { origin: url || 'unknown-site', title: tab.title?.trim() || '当前网站', url };
  }
}

async function ensureTaskForTab(tab: chrome.tabs.Tab, preferredTaskId?: string): Promise<ApplicationTask> {
  if (tab.id == null) throw new Error('No active tab found');
  const boundTaskId = await getBoundTaskId(tab.id);
  const existingTaskId = preferredTaskId || boundTaskId;
  if (existingTaskId) {
    const existing = await getApplicationTask(existingTaskId);
    if (existing && existing.status !== 'archived') {
      const now = Date.now();
      const refreshed = { ...existing, lastOpenedAt: now, updatedAt: Math.max(existing.updatedAt, now) };
      await Promise.all([saveApplicationTask(refreshed), setTaskBinding(tab.id, refreshed.id)]);
      return refreshed;
    }
  }
  const identity = siteIdentity(tab);
  const now = Date.now();
  const created = createApplicationTask({
    id: createApplicationTaskId(),
    batchId: createApplicationBatchId(new Date(now)),
    siteOrigin: identity.origin,
    siteTitle: identity.title,
    initialUrl: identity.url,
    now,
  });
  await Promise.all([saveApplicationTask(created), setTaskBinding(tab.id, created.id)]);
  return created;
}

function autoRunKey(tabId: number): string {
  return `autoRun:${tabId}`;
}

function markerStoreKey(tabId: number): string {
  return `autoRunMarkers:${tabId}`;
}

async function getAutoRunState(tabId: number): Promise<AutoRunState | null> {
  const result = await chrome.storage.session.get(autoRunKey(tabId));
  const state = (result[autoRunKey(tabId)] as AutoRunState | undefined) ?? null;
  if (!state) return null;
  if (state.agent && state.agent.protocolVersion !== AGENT_PROTOCOL_VERSION) {
    return {
      ...state,
      status: state.status === 'paused' ? 'stopped' : state.status,
      pauseReason: undefined,
      message: 'Agent 规划规则已升级，请重新开始当前页',
      agent: undefined,
      history: state.history ?? [],
    };
  }
  return { ...state, history: state.history ?? [] };
}

async function saveAutoRunState(state: AutoRunState): Promise<void> {
  state.updatedAt = Date.now();
  await chrome.storage.session.set({ [autoRunKey(state.tabId)]: state });
  if (state.taskId) {
    await updateApplicationTask(state.taskId, (task) => {
      const nextTask = updateTaskFromAutoRun(task, {
        status: state.status,
        pauseReason: state.pauseReason as ApplicationTaskPauseReason | undefined,
        pageCount: state.pageCount,
        filledCount: state.filledCount,
        message: state.message,
        history: state.history,
        updatedAt: state.updatedAt,
      });
      const checkpoint: ApplicationRunnerCheckpoint = {
        status: state.status,
        lastPageKey: state.lastPageKey,
        history: state.history,
        pauseReason: state.pauseReason as ApplicationTaskPauseReason | undefined,
        confirmedMaterialPageKey: state.confirmedMaterialPageKey,
        agent: state.agent,
        batchPhase: state.batchPhase,
        batchBlueprint: state.batchBlueprint,
        batchPlan: state.batchPlan,
        updatedAt: state.updatedAt,
      };
      return updateTaskRunnerCheckpoint(nextTask, checkpoint);
    });
  }
  const badge = state.status === 'running' ? '…' : state.status === 'paused' ? '!' : state.status === 'complete' ? '✓' : '';
  const color = state.status === 'paused' ? '#f59e0b' : state.status === 'complete' ? '#22c55e' : '#257ffd';
  await chrome.action.setBadgeBackgroundColor({ tabId: state.tabId, color }).catch(() => undefined);
  await chrome.action.setBadgeText({ tabId: state.tabId, text: badge }).catch(() => undefined);
}

export function resumeAlarmName(taskId: string): string {
  return `baotian:resume:${taskId}`;
}

export async function scheduleTaskResume(taskId: string, tabId: number, delayMs: number): Promise<void> {
  if (await getBoundTaskId(tabId) !== taskId) return;
  const task = await getApplicationTask(taskId);
  if (!task || task.status === 'archived' || !canResumeRunner(task.runner)) return;
  const when = Date.now() + Math.max(0, delayMs);
  const alarmName = resumeAlarmName(taskId);
  await chrome.alarms.clear(alarmName).catch(() => false);
  await chrome.alarms.create(alarmName, { when });
  await updateApplicationTask(taskId, (current) => {
    if (current.status === 'archived' || !canResumeRunner(current.runner)) return current;
    return updateTaskRunnerCheckpoint(current, {
      ...current.runner!,
      resumeAfter: when,
      updatedAt: Math.max(current.updatedAt, Date.now()),
    });
  });
}

export async function resumeTaskForTab(tabId: number): Promise<void> {
  const taskId = await getBoundTaskId(tabId);
  if (!taskId) return;
  const task = await getApplicationTask(taskId);
  if (!task || task.status === 'archived' || !canResumeRunner(task.runner)) return;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab) return;
  const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(
    tabId,
    { type: 'getPageMeta' },
    false,
  ).catch(() => null);
  if (!meta) return;
  const existing = await getAutoRunState(tabId);
  const runner = task.runner!;
  const state: AutoRunState = existing?.taskId === task.id && existing.status === 'running'
    ? existing
    : {
        tabId,
        taskId: task.id,
        batchId: task.batchId,
        status: 'running',
        pageCount: task.pageCount,
        filledCount: task.filledCount,
        message: task.message,
        updatedAt: Date.now(),
        history: runner.history,
        confirmedMaterialPageKey: runner.confirmedMaterialPageKey,
        agent: runner.agent,
        lastPageKey: semanticPageKey(meta),
      };
  state.lastPageKey = semanticPageKey(meta);
  await saveAutoRunState(state);
  await processAutoRun(tabId);
}

async function persistScanSnapshot(state: AutoRunState, scan: ScanSuccessResponse): Promise<void> {
  if (!state.taskId) return;
  const auditSnapshot = await sendToContentScript<{
    fields: Array<{ index: number; field: FormFieldInfo }>;
    websiteMaterials: WebsiteMaterialCandidate[];
  }>(state.tabId, { type: 'getAuditPageSnapshot' }).catch(() => null);
  const snapshot = buildPageSnapshot({
    pageKey: semanticPageKey({ url: scan.pageUrl, label: scan.pageLabel, signature: scan.pageSignature }),
    pageLabel: scan.pageLabel,
    pageUrl: scan.pageUrl,
    pageSignature: scan.pageSignature,
    capturedAt: Date.now(),
    fields: auditSnapshot?.fields.map((result) => ({ ...result.field, index: result.index })) ?? scan.fields,
    matches: scan.matches,
    websiteMaterials: auditSnapshot?.websiteMaterials ?? [],
  });
  await updateApplicationTask(state.taskId, (task) => upsertTaskPage(task, snapshot));
}

async function savePageAnalysis(
  taskId: string,
  scan: ScanSuccessResponse,
  markers: PageMarkerItem[],
  checkedIndexes: number[],
  repeatPlan: RepeatableRecordPlan,
  applicationTitle = '',
): Promise<void> {
  const pageKey = semanticPageKey({
    url: scan.pageUrl,
    label: scan.pageLabel,
    signature: scan.pageSignature,
  });
  if (!pageKey) return;
  const profileFields = await getAllTextFields();
  const profileInstitution = profileFields.find((field) => (
    /^(?:学校|所在学校|本科院校|毕业院校)$/u.test(field.key.trim())
  ))?.value ?? '';
  const identity = inferAgentApplicationIdentityFromPage({
    title: applicationTitle || scan.pageLabel,
    url: scan.pageUrl,
    pageLabel: scan.pageLabel,
    fields: scan.fields,
    profileInstitution,
  });
  const capturedAt = Date.now();
  const agentSnapshot = buildSnapshotForAgent({
    ...scan,
    applicationTitle: applicationTitle || scan.applicationTitle,
  });
  await updateApplicationTask(taskId, (task) => upsertTaskPageAnalysis(
    updateTaskApplicationIdentity(task, identity, capturedAt),
    {
    pageKey,
    pageLabel: scan.pageLabel,
    pageUrl: scan.pageUrl,
    pageSignature: scan.pageSignature,
    fields: scan.fields,
    matches: scan.matches,
    markers,
    checkedIndexes,
    repeatPlan,
    ai: scan.ai,
    agentSnapshot,
    capturedAt,
  }));
}

function isCurrentPageRestore(tabId: number, generation: number): boolean {
  return isCurrentRestoreGeneration(pageRestoreGenerations.get(tabId), generation);
}

async function restoreAnalysisToTab(
  tabId: number,
  analysis: ApplicationPageAnalysis,
  generation?: number,
): Promise<boolean> {
  const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(
    tabId,
    { type: 'getPageMeta' },
  );
  if (generation != null && !isCurrentPageRestore(tabId, generation)) return false;
  if (semanticPageKey(meta) !== analysis.pageKey) return false;
  await sendToContentScript(tabId, { type: 'markPreview', items: analysis.markers });
  return true;
}

async function restoreCachedAnalysisForTab(
  tabId: number,
  generation: number,
): Promise<CachedAnalysisRestoreResult> {
  const taskId = await getBoundTaskId(tabId);
  if (!isCurrentPageRestore(tabId, generation)) return 'superseded';
  if (!taskId) return 'missing';
  const task = await getApplicationTask(taskId);
  if (!isCurrentPageRestore(tabId, generation)) return 'superseded';
  if (!task) return 'missing';
  const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(
    tabId,
    { type: 'getPageMeta' },
  );
  if (!isCurrentPageRestore(tabId, generation)) return 'superseded';
  const analysis = task.pageAnalyses?.[semanticPageKey(meta)];
  if (!analysis || !shouldReusePageAnalysis(analysis, meta)) return 'missing';
  const refreshed = await refreshAnalysisFromTab(tabId, analysis);
  if (!isCurrentPageRestore(tabId, generation)) return 'superseded';
  if (!refreshed) return 'unverified';
  return await restoreAnalysisToTab(tabId, refreshed, generation) ? 'restored' : 'unverified';
}

function defaultCheckedIndexes(scan: ScanSuccessResponse): number[] {
  const fieldByIndex = new Map(scan.fields.map((field) => [field.index, field]));
  return scan.matches.flatMap((match) => {
    const field = fieldByIndex.get(match.index);
    if (!field || match.kind === 'file' || isMeaningfullyFilled(field)) return [];
    return match.confidence === 'low' && (match.fillMode ?? field.fillMode) !== 'long' ? [] : [match.index];
  });
}

async function refreshAnalysisFromTab(
  tabId: number,
  analysis: ApplicationPageAnalysis,
): Promise<ApplicationPageAnalysis | null> {
  const scanResults = await sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(
    tabId,
    { type: 'scan' },
  ).catch(() => []);
  const currentFields = scanResults.map((result) => {
    const field = { ...result.field, index: result.index };
    if (field.kind === 'file') {
      field.label = materialFieldDisplayLabel(field, analysis.pageLabel, field.index);
    }
    return field;
  });
  if (currentFields.length === 0) return null;

  const currentByFingerprint = new Map<string, FormFieldInfo[]>();
  for (const field of currentFields) {
    const fingerprint = fieldFingerprint(field);
    const candidates = currentByFingerprint.get(fingerprint) ?? [];
    candidates.push(field);
    currentByFingerprint.set(fingerprint, candidates);
  }
  const indexMap = new Map<number, number>();
  for (const savedField of analysis.fields) {
    const candidates = currentByFingerprint.get(fieldFingerprint(savedField)) ?? [];
    const sameIndex = candidates.findIndex((candidate) => candidate.index === savedField.index);
    const current = sameIndex >= 0 ? candidates.splice(sameIndex, 1)[0] : candidates.shift();
    if (current) indexMap.set(savedField.index, current.index);
  }
  const matches = analysis.matches.flatMap((match) => {
    const index = indexMap.get(match.index);
    return index == null ? [] : [{ ...match, index }];
  });
  const markers = derivePageMarkers(currentFields, matches);
  return {
    ...analysis,
    fields: currentFields,
    matches,
    markers,
    checkedIndexes: analysis.checkedIndexes.flatMap((index) => {
      const currentIndex = indexMap.get(index);
      return currentIndex == null ? [] : [currentIndex];
    }),
  };
}

function autoRunResponse(state: AutoRunState): AutoRunSuccessResponse {
  return { ok: true, type: 'autoRun', ...state };
}

async function rememberPageMarkers(
  tabId: number,
  identity: { url?: string; label?: string; signature?: string },
  items: PageMarkerItem[],
): Promise<void> {
  const key = semanticPageKey(identity);
  if (!key) return;
  const storageKey = markerStoreKey(tabId);
  const stored = await chrome.storage.session.get(storageKey);
  const pages = (stored[storageKey] as Record<string, { items: PageMarkerItem[]; updatedAt: number }> | undefined) ?? {};
  pages[key] = { items, updatedAt: Date.now() };
  const trimmed = Object.fromEntries(
    Object.entries(pages).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 30),
  );
  await chrome.storage.session.set({ [storageKey]: trimmed });
}

async function restorePageMarkers(tabId: number, url: string | undefined, generation: number): Promise<void> {
  const legacyKey = canonicalPageUrl(url);
  if (!legacyKey) return;
  const storageKey = markerStoreKey(tabId);
  const stored = await chrome.storage.session.get(storageKey);
  if (!isCurrentPageRestore(tabId, generation)) return;
  const pages = stored[storageKey] as Record<string, { items: PageMarkerItem[] }> | undefined;
  if (!pages) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
    if (!isCurrentPageRestore(tabId, generation)) return;
    const current = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!current || canonicalPageUrl(current.url) !== legacyKey) return;
    const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(
      tabId,
      { type: 'getPageMeta' },
      false,
    ).catch(() => undefined);
    const key = meta ? semanticPageKey(meta) : legacyKey;
    const page = pages[key] ?? pages[legacyKey];
    if (!page) continue;
    if (!isCurrentPageRestore(tabId, generation)) return;
    const result = await sendToContentScript<{ marked?: number }>(
      tabId,
      { type: 'markPreview', items: page.items },
    ).catch(() => undefined);
    if ((result?.marked ?? 0) > 0 || page.items.length === 0) return;
  }
}

async function clearPageMarkers(tabId: number, generation: number): Promise<void> {
  if (!isCurrentPageRestore(tabId, generation)) return;
  await sendToContentScript(tabId, { type: 'markPreview', items: [] }).catch(() => undefined);
}

async function restoreMarkersAfterNavigation(
  tabId: number,
  url: string | undefined,
  generation: number,
): Promise<void> {
  const cachedResult = await restoreCachedAnalysisForTab(tabId, generation).catch<CachedAnalysisRestoreResult>(
    () => 'unverified',
  );
  if (!isCurrentPageRestore(tabId, generation) || cachedResult === 'superseded') return;
  if (shouldRestoreLegacyMarkers(cachedResult)) {
    await restorePageMarkers(tabId, url, generation).catch(() => undefined);
    return;
  }
  if (cachedResult === 'unverified') await clearPageMarkers(tabId, generation);
}

async function sendToContentScript<T>(
  tabId: number,
  message: unknown,
  retryAfterInjection = true,
): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message) as T;
  } catch (err) {
    if (!retryAfterInjection) throw err;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
    return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
  }
}

function normalizeMaterialText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

function scoreRole(text: string, role: MaterialRole): RoleScore {
  const normalized = normalizeMaterialText(text);
  if (role === 'award_certificate' && /荣誉学院|荣誉班|强化班|拔尖班|强基班|培优班/.test(normalized)) {
    return { role, score: 0, exact: false };
  }
  const keywords = ROLE_KEYWORDS[role];
  let score = 0;
  let exact = false;

  for (const keyword of keywords.exact) {
    if (normalized.includes(normalizeMaterialText(keyword))) {
      score += 10;
      exact = true;
    }
  }

  for (const keyword of keywords.alias) {
    if (normalized.includes(normalizeMaterialText(keyword))) {
      score += 3;
    }
  }

  if ((role === 'id_card_front' || role === 'id_card_back') && normalized.includes('身份证')) {
    score += 2;
  }
  if (role === 'id_photo' && normalized.includes('个人照片')) {
    score += 3;
  }

  return { role, score, exact };
}

function detectBestRole(text: string): RoleScore | null {
  const scores = (Object.keys(ROLE_KEYWORDS) as MaterialRole[])
    .map((role) => scoreRole(text, role))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) return null;
  if (scores.length > 1 && scores[0].score === scores[1].score) return null;
  return scores[0];
}

function scoreCandidateForField(text: string, fieldRole: MaterialRole): RoleScore {
  const compatibleRoles = fieldRole === 'language_certificate'
    ? [fieldRole, 'cet4_certificate', 'cet6_certificate'] as MaterialRole[]
    : [fieldRole];
  const best = compatibleRoles
    .map((role) => scoreRole(text, role))
    .sort((a, b) => b.score - a.score)[0];
  return { role: fieldRole, score: best?.score ?? 0, exact: best?.exact ?? false };
}

function acceptsFile(accept: string | undefined, filename: string, fileType: string): boolean {
  const rules = (accept ?? '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;

  const lowerName = filename.toLowerCase();
  const lowerType = fileType.toLowerCase();
  return rules.some((rule) => {
    if (rule === '*/*') return true;
    if (rule.endsWith('/*')) return lowerType.startsWith(rule.slice(0, -1));
    if (rule.startsWith('.')) return lowerName.endsWith(rule);
    return lowerType === rule;
  });
}

function effectiveFileAccept(field: FormFieldInfo): string {
  if (field.accept?.trim()) return field.accept;
  const text = [field.label, field.hint, field.context, field.html].filter(Boolean).join(' ');
  if (/(?:^|\s|[，,：:（(])pdf(?:$|\s|[，,。；;）)])/i.test(text)) return '.pdf,application/pdf';
  if (/图片|照片|图像|jpe?g|png/i.test(text)) return 'image/*';
  if (/word|docx?/i.test(text)) return '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return '';
}

function isCandidateSpecificEnough(text: string, role: MaterialRole): boolean {
  const normalized = normalizeMaterialText(text);
  if (role === 'id_card') {
    const singleSide = /(正面|人像面|反面|国徽面)/.test(normalized) && !/正反面/.test(normalized);
    return !singleSide;
  }
  return true;
}

function materialCandidatePriority(record: FileRecord, role: MaterialRole): number {
  const stem = normalizeMaterialText(record.filename.replace(/\.[^.]+$/, ''));
  if (role === 'id_card') {
    if (stem === '身份证') return 30;
    if (/身份证正反面/.test(stem)) return 25;
    if (/身份证/.test(stem)) return 15;
  }
  return 0;
}

function inferFileType(filename: string, fileType: string): string {
  if (fileType) return fileType;
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  if (/\.pdf$/i.test(filename)) return 'application/pdf';
  if (/\.doc$/i.test(filename)) return 'application/msword';
  if (/\.docx$/i.test(filename)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return '';
}

async function filterReadableFileRecords(records: FileRecord[]): Promise<FileRecord[]> {
  const checks = await Promise.all(records.map(async (record) => {
    try {
      await record.fileBody.slice(0, 1).arrayBuffer();
      return record;
    } catch {
      return null;
    }
  }));
  return checks.filter((record): record is FileRecord => record != null);
}

function maxFileBytesFromField(field: FormFieldInfo): number | null {
  const text = [field.label, field.hint, field.context, field.html].filter(Boolean).join(' ');
  const match = text.match(/(?:不超过|不得超过|小于|最大|≤|<=)\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB)/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024;
  return Number.isFinite(value) ? value * multiplier : null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function getCategoryName(record: FileRecord, categoryById: Map<number, Category>): string {
  return categoryById.get(record.categoryId)?.name ?? '';
}

function hasSpecificRecordOverlap(field: FormFieldInfo, record: FileRecord): boolean {
  const fieldText = normalizeMaterialText(field.label || field.hint || '');
  const candidates = [
    record.filename.replace(/\.[^.]+$/, ''),
    record.fileDescription,
  ].map((text) => normalizeMaterialText(text)
    .replace(/证明材料|证明|证书|扫描件|附件|文件|汇总|完整版/g, ''))
    .filter((text) => text.length >= 3);
  return candidates.some((text) => fieldText.includes(text) || text.includes(fieldText));
}

function detectFileFieldRole(field: FormFieldInfo, pageLabel = ''): RoleScore | null {
  const roleTexts = materialFieldRoleTexts(field, pageLabel);
  const directRole = detectBestRole(roleTexts.direct);
  if (directRole) return directRole;
  return detectBestRole(roleTexts.fallback);
}

function matchFileFields(
  fields: FormFieldInfo[],
  fileRecords: FileRecord[],
  categories: Category[],
  pageLabel = '',
): MatchResult[] {
  const categoryById = new Map(categories.flatMap((category) => (
    category.id == null ? [] : [[category.id, category] as const]
  )));
  const fileFields = fields.filter((field) => field.kind === 'file');
  const availableRecords = fileRecords.filter((record) => record.id != null && record.fileBody.size > 0);

  return fileFields.flatMap((field) => {
    const fieldRole = detectFileFieldRole(field, pageLabel);
    if (!fieldRole) return [];
    const maxFileBytes = maxFileBytesFromField(field);

    const candidates = availableRecords
      .map((record) => {
        const specificText = [
          record.filename,
          record.fileDescription,
        ].filter(Boolean).join(' ');
        const categoryText = getCategoryName(record, categoryById);
        let materialRole = scoreCandidateForField(specificText, fieldRole.role);
        if (materialRole.score === 0 && categoryText) {
          const categoryRole = scoreCandidateForField(categoryText, fieldRole.role);
          materialRole = { ...categoryRole, score: Math.min(3, categoryRole.score), exact: false };
        }
        return { record, materialRole };
      })
      .filter(({ record, materialRole }) => (
        materialRole.score > 0 &&
        isCandidateSpecificEnough([
          record.filename,
          record.fileDescription,
          getCategoryName(record, categoryById),
        ].filter(Boolean).join(' '), fieldRole.role) &&
        acceptsFile(effectiveFileAccept(field), record.filename, inferFileType(record.filename, record.fileType)) &&
        (maxFileBytes == null || record.fileSize <= maxFileBytes)
      ))
      .sort((a, b) => (
        b.materialRole.score - a.materialRole.score ||
        materialCandidatePriority(b.record, fieldRole.role) - materialCandidatePriority(a.record, fieldRole.role) ||
        b.record.createdAt - a.record.createdAt
      ));

    const best = candidates[0];
    if (!best?.record.id) return [];

    const isHighlySpecificField = normalizeMaterialText(field.label).length > 30;
    const confidence: MatchResult['confidence'] =
      isHighlySpecificField && !hasSpecificRecordOverlap(field, best.record)
        ? 'low'
        : fieldRole.exact && best.materialRole.exact
        ? 'high'
        : fieldRole.score >= 5 && best.materialRole.score >= 5
          ? 'medium'
          : 'low';

    return [{
      kind: 'file',
      index: field.index,
      fieldKey: fieldRole.role,
      value: best.record.filename,
      shortLabel: MATERIAL_LABELS[fieldRole.role],
      confidence,
      fileRecordId: best.record.id,
      fileName: best.record.filename,
      fileType: inferFileType(best.record.filename, best.record.fileType),
      materialRole: fieldRole.role,
      fileCandidates: candidates.slice(0, 5).flatMap(({ record }) => (
        record.id == null ? [] : [{
          fileRecordId: record.id,
          fileName: record.filename,
          fileType: inferFileType(record.filename, record.fileType),
        }]
      )),
      source: 'material',
    }];
  });
}

async function reviewFileMatchesWithAi(
  pageSignature: string,
  fileFields: FormFieldInfo[],
  localMatches: MatchResult[],
  apiConfig: Awaited<ReturnType<typeof getApiConfig>>,
): Promise<{ matches: MatchResult[]; attempted: boolean; cached: boolean; reviewed: number; error: string }> {
  if (localMatches.length === 0) {
    return { matches: localMatches, attempted: false, cached: false, reviewed: 0, error: '' };
  }

  const cacheKey = `materials:${shortStableHash(JSON.stringify({
    pageSignature,
    fields: fileFields.map((field) => fieldFingerprint(field)),
    candidates: localMatches.map((match) => [match.index, match.fileCandidates]),
    api: [apiConfig.baseUrl, apiConfig.model, apiConfig.providerId, apiConfig.apiMode, apiConfig.fastMode],
  }))}`;
  const cached = getCachedAiMatches(cacheKey);
  if (cached) {
    return {
      matches: cached,
      attempted: true,
      cached: true,
      reviewed: cached.filter((match) => match.source === 'ai_reviewed').length,
      error: '',
    };
  }

  const fieldByIndex = new Map(fileFields.map((field) => [field.index, field]));
  const prompt = `你是推免报名材料匹配审核助手。请从每个上传字段给出的候选文件中选择语义最准确的一份。

规则：
- 只能选择该字段候选列表中真实存在的 fileRecordId，不能编造文件或编号。
- 必须综合字段名称、说明、格式要求和文件名判断，不能仅凭“证明”“材料”等泛词匹配。
- 身份证、成绩单、学籍证明、四六级成绩、申请表等材料不可互相替代。
- 含义明确返回 high；基本明确但仍需用户重点预览返回 medium；无法可靠判断则不要返回该字段。
- 只返回 JSON 数组，每项格式：{"index":数字,"fileRecordId":数字,"confidence":"high|medium"}。

上传字段与候选：
${localMatches.map((match) => {
    const field = fieldByIndex.get(match.index);
    const fieldText = [field?.label, field?.hint, field?.context, field?.accept]
      .filter(Boolean)
      .join(' | ')
      .replace(/\s+/g, ' ')
      .slice(0, 500);
    const candidates = (match.fileCandidates ?? []).map((candidate) => (
      `${candidate.fileRecordId}:${candidate.fileName}`
    )).join('；');
    return `[${match.index}] 字段=${fieldText}\n候选=${candidates}`;
  }).join('\n')}`;

  try {
    const content = await aiRequestQueue.run(() => requestModelText(apiConfig, prompt));
    const json = content.match(/\[[\s\S]*\]/)?.[0];
    if (!json) throw new Error('材料匹配响应不是有效 JSON 数组');
    const choices = JSON.parse(json) as Array<{ index?: unknown; fileRecordId?: unknown; confidence?: unknown }>;
    const choiceByIndex = new Map(choices.map((choice) => [Number(choice.index), choice]));
    let reviewed = 0;
    const matches: MatchResult[] = localMatches.map((match): MatchResult => {
      const choice = choiceByIndex.get(match.index);
      const candidate = match.fileCandidates?.find((item) => item.fileRecordId === Number(choice?.fileRecordId));
      if (!candidate || (choice?.confidence !== 'high' && choice?.confidence !== 'medium')) {
        return { ...match, confidence: 'low' as const };
      }
      reviewed++;
      const confidence: MatchResult['confidence'] = choice.confidence;
      return {
        ...match,
        value: candidate.fileName,
        confidence,
        fileRecordId: candidate.fileRecordId,
        fileName: candidate.fileName,
        fileType: candidate.fileType,
        source: 'ai_reviewed' as const,
      };
    });
    cacheAiMatches(cacheKey, matches);
    return { matches, attempted: true, cached: false, reviewed, error: '' };
  } catch (error) {
    return {
      matches: localMatches,
      attempted: true,
      cached: false,
      reviewed: 0,
      error: error instanceof Error ? error.message : 'AI 材料匹配失败',
    };
  }
}

export default defineBackground(() => {
  if (import.meta.env.DEV) {
    seedDevData();
  }

  chrome.runtime.onMessage.addListener((request: Request & { target?: string }, _sender, sendResponse) => {
    if (request.target === 'baotian-offscreen') return false;
    if (request.target === 'baotian-background' && (request as any).type === 'agentModelHeartbeat') {
      sendResponse({ ok: true });
      return false;
    }
    handleMessage(request)
      .then(sendResponse)
      .catch((err) => sendResponse(errorResponse(err.message)));

    return true;
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' && !changeInfo.url) return;
    const generation = (pageRestoreGenerations.get(tabId) ?? 0) + 1;
    pageRestoreGenerations.set(tabId, generation);
    setTimeout(() => {
      void enqueueSerializedRestore(pageRestoreTails, tabId, async () => {
        if (!isCurrentPageRestore(tabId, generation)) return;
        await restoreMarkersAfterNavigation(tabId, changeInfo.url ?? tab.url, generation);
      }).catch(() => undefined);
    }, 300);
    if (tab.active) {
      void getBoundTaskId(tabId).then(async (taskId) => {
        if (!taskId) return;
        const task = await getApplicationTask(taskId);
        if (task && task.status !== 'archived' && canResumeRunner(task.runner)) {
          await scheduleTaskResume(task.id, tabId, 600);
        }
      });
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    const generation = (pageRestoreGenerations.get(tabId) ?? 0) + 1;
    pageRestoreGenerations.set(tabId, generation);
    void chrome.tabs.get(tabId).then(async (tab) => {
      await enqueueSerializedRestore(pageRestoreTails, tabId, async () => {
        if (!isCurrentPageRestore(tabId, generation)) return;
        await restoreMarkersAfterNavigation(tabId, tab.url, generation);
      }).catch(() => undefined);
      const taskId = await getBoundTaskId(tabId);
      if (!taskId) return;
      const task = await getApplicationTask(taskId);
      if (task && task.status !== 'archived' && canResumeRunner(task.runner)) {
        await scheduleTaskResume(task.id, tabId, 600);
      }
    }).catch(() => undefined);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    const prefix = 'baotian:resume:';
    if (!alarm.name.startsWith(prefix)) return;
    const taskId = alarm.name.slice(prefix.length);
    void getTaskBindings().then(async (bindings) => {
      const entry = Object.entries(bindings).find(([, boundTaskId]) => boundTaskId === taskId);
      if (!entry) return;
      const tabId = Number(entry[0]);
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (!tab) return;
      await resumeTaskForTab(tabId);
    }).catch(() => undefined);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    autoRunInFlight.delete(tabId);
    pageRestoreGenerations.delete(tabId);
    void getAutoRunState(tabId).then(async (state) => {
      if (state?.taskId && state.status === 'running') {
        state.status = 'paused';
        state.pauseReason = 'page';
        state.message = '缃戠珯鏍囩椤靛凡鍏抽棴锛屼换鍔¤褰曞凡淇濈暀';
        await saveAutoRunState(state);
      }
      await Promise.all([
        removeTaskBinding(tabId),
        chrome.storage.session.remove([autoRunKey(tabId), markerStoreKey(tabId)]),
      ]);
    });
  });

});

async function seedDevData() {
  const [textFields] = await Promise.all([
    getAllTextFields(),
    isApiConfigured(),
  ]);

  const devFields = [
    { key: '姓名', value: '' },
    { key: '手机号', value: '' },
    { key: '住址', value: '' },
    { key: '身份证号码', value: '' },
    { key: '出生日期', value: '' },
    { key: '民族', value: '' },
    { key: '性别', value: '' },
    { key: '婚否', value: '' },
    { key: '政治面貌', value: '' },
    { key: '户口所在地详细地址', value: '' },
    { key: '邮箱', value: '' },
  ];

  const existingKeys = new Set(textFields.map((field) => field.key));
  const missingFields = devFields.filter((field) => !existingKeys.has(field.key));
  if (missingFields.length > 0) {
    await saveAllTextFields([...textFields, ...missingFields]);
  }
}

async function handleMessage(request: Request): Promise<Response> {
  if (request.type === 'inspectPage') {
    return handleInspectPage();
  }
  if (request.type === 'startScan') {
    return handleScan();
  }
  if (request.type === 'startFill') {
    return handleFill(request.payload!.matches);
  }
  if (request.type === 'manualFill') {
    return handleManualFill(request.payload!.value);
  }
  if (request.type === 'markPageFields') {
    return handleMarkPageFields(request.payload!.items);
  }
  if (request.type === 'focusPageField') {
    return handleFocusPageField(request.payload!.index);
  }
  if (request.type === 'focusAgentTarget') {
    return handleFocusAgentTarget(request.payload!);
  }
  if (request.type === 'controlPageAgent') {
    return handleControlPageAgent(request.payload!.command);
  }
  if (request.type === 'startAutoRun') {
    return handleStartAutoRun();
  }
  if (request.type === 'getAutoRunStatus') {
    return handleGetAutoRunStatus();
  }
  if (request.type === 'stopAutoRun') {
    return handleStopAutoRun();
  }
  if (request.type === 'confirmMaterialsAndResume') {
    return handleConfirmMaterialsAndResume();
  }
  if (request.type === 'previewExistingMaterial') {
    return handlePreviewExistingMaterial(request.payload!.index);
  }
  if (request.type === 'getCurrentApplicationTask') {
    return handleGetCurrentApplicationTask();
  }
  if (request.type === 'getCurrentPageAnalysis') {
    return handleGetCurrentPageAnalysis();
  }
  if (request.type === 'savePageAnalysis') {
    return handleSavePageAnalysis(request.payload!);
  }
  if (request.type === 'listApplicationTasks') {
    return handleListApplicationTasks();
  }
  if (request.type === 'archiveApplicationTask') {
    return handleArchiveApplicationTask(request.payload!.taskId);
  }
  if (request.type === 'openAuditCenter') {
    return handleOpenAuditCenter();
  }
  if (request.type === 'getAuditPreflight') {
    return handleGetAuditPreflight(request.payload!.taskIds);
  }
  if (request.type === 'runFinalAudit') {
    return handleRunFinalAudit(request.payload!);
  }
  if (request.type === 'focusApplicationTask') {
    return handleFocusApplicationTask(request.payload!.taskId);
  }
  return errorResponse('Unknown message type');
}

async function handleGetCurrentApplicationTask(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const currentTaskId = await getBoundTaskId(tab.id);
  return {
    ok: true,
    type: 'applicationTask',
    currentTaskId,
    task: currentTaskId ? await getApplicationTask(currentTaskId) : null,
  };
}

async function handleGetCurrentPageAnalysis(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(
    tab.id,
    { type: 'getPageMeta' },
  );
  const currentPageKey = semanticPageKey(meta);
  const taskId = await getBoundTaskId(tab.id);
  const task = taskId ? await getApplicationTask(taskId) : null;
  const cached = task?.pageAnalyses?.[currentPageKey] ?? null;
  if (!cached || !shouldReusePageAnalysis(cached, meta)) {
    return { ok: true, type: 'pageAnalysis', analysis: null, currentPageKey };
  }
  const analysis = await refreshAnalysisFromTab(tab.id, cached);
  if (!analysis) return { ok: true, type: 'pageAnalysis', analysis: null, currentPageKey };
  await restoreAnalysisToTab(tab.id, analysis).catch(() => false);
  return { ok: true, type: 'pageAnalysis', analysis, currentPageKey };
}

async function handleSavePageAnalysis(
  payload: MessageMap['savePageAnalysis'],
): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(
    tab.id,
    { type: 'getPageMeta' },
  );
  if (semanticPageKey(meta) !== semanticPageKey({
    url: payload.scan.pageUrl,
    label: payload.scan.pageLabel,
    signature: payload.scan.pageSignature,
  })) {
    return errorResponse('The page changed before its analysis could be saved');
  }
  const task = await ensureTaskForTab(tab);
  await savePageAnalysis(task.id, payload.scan, payload.markers, payload.checkedIndexes, payload.repeatPlan, tab.title || '');
  return { ok: true, type: 'pageAction' };
}

async function handleListApplicationTasks(): Promise<Response> {
  const tab = await getCurrentTab();
  const currentTaskId = tab?.id == null ? undefined : await getBoundTaskId(tab.id);
  return {
    ok: true,
    type: 'applicationTasks',
    currentTaskId,
    tasks: await getApplicationTasks(),
  };
}

async function handleArchiveApplicationTask(taskId: string): Promise<Response> {
  const task = await archiveApplicationTask(taskId);
  return { ok: true, type: 'applicationTask', task };
}

async function handleOpenAuditCenter(): Promise<Response> {
  const tab = await getCurrentTab();
  const currentTaskId = tab?.id == null ? undefined : await getBoundTaskId(tab.id);
  const url = new URL(chrome.runtime.getURL('/audit.html'));
  if (currentTaskId) url.searchParams.set('currentTaskId', currentTaskId);
  await chrome.tabs.create({ url: url.href });
  return { ok: true, type: 'pageAction' };
}

async function handleGetAuditPreflight(taskIds: string[]): Promise<Response> {
  const prepared = await prepareFinalAudit(taskIds);
  return {
    ok: true,
    type: 'auditPreflight',
    preflight: prepared.preflight,
    fingerprint: prepared.fingerprint,
  };
}

async function handleRunFinalAudit(payload: MessageMap['runFinalAudit']): Promise<Response> {
  if (payload.confirmed !== true) return errorResponse('最终检查需要在预检清单中再次确认');
  const result = await runFinalAudit(payload.taskIds, Boolean(payload.force));
  return { ok: true, type: 'finalAudit', ...result };
}

async function handleFocusApplicationTask(taskId: string): Promise<Response> {
  const bindings = await getTaskBindings();
  const openTabId = Object.entries(bindings).find(([, boundTaskId]) => boundTaskId === taskId)?.[0];
  if (openTabId) {
    const tabId = Number(openTabId);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab) {
      await chrome.tabs.update(tabId, { active: true });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true, type: 'pageAction' };
    }
  }
  const task = await getApplicationTask(taskId);
  if (!task) return errorResponse('申请任务不存在或已删除');
  await chrome.tabs.create({ url: task.initialUrl });
  return { ok: true, type: 'pageAction' };
}

async function handleInspectPage(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const scanResults = await sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(
    tab.id,
    { type: 'scan' },
  );
  const fields = (scanResults ?? []).map((result) => result.field);
  return {
    ok: true,
    type: 'inspect',
    total: fields.length,
    required: fields.filter((field) => field.required).length,
    unfilled: fields.filter((field) => !isMeaningfullyFilled(field)).length,
    protected: fields.filter((field) => field.protected).length,
  };
}

async function handleManualFill(value: string): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const result = await sendToContentScript<{ ok: boolean }>(tab.id, { type: 'manualFill', value });
  return result.ok
    ? { ok: true, type: 'fill', success: 1, failure: 0 }
    : { ok: true, type: 'fill', success: 0, failure: 1 };
}

async function handleMarkPageFields(
  items: PageMarkerItem[],
): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(tab.id, { type: 'getPageMeta' });
  await rememberPageMarkers(tab.id, meta, items);
  await sendToContentScript(tab.id, { type: 'markPreview', items });
  return { ok: true, type: 'pageAction' };
}

async function handleFocusPageField(index: number): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  await sendToContentScript(tab.id, { type: 'focusField', index });
  return { ok: true, type: 'pageAction' };
}

async function handlePreviewExistingMaterial(index: number): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const result = await sendToContentScript<{
    ok: boolean;
    dataUrl?: string;
    mimeType?: string;
    evidence?: string;
    error?: string;
  }>(tab.id, { type: 'getExistingMaterialPreview', index });
  if (!result?.ok) return errorResponse(result?.error || '无法读取网页现有材料预览');
  return {
    ok: true,
    type: 'existingMaterialPreview',
    dataUrl: result.dataUrl || '',
    mimeType: result.mimeType || '',
    evidence: result.evidence || '网页已有材料',
  };
}

async function handleFocusAgentTarget(payload: { pageKey: string; targetId: string }): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const result = await sendToContentScript<{ ok: boolean }>(tab.id, {
    type: 'focusAgentTarget',
    pageKey: payload.pageKey,
    targetId: payload.targetId,
  });
  return result?.ok ? { ok: true, type: 'pageAction' } : errorResponse('Agent target is no longer on this page');
}

async function handleControlPageAgent(command: AgentControlCommand): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const state = await getAutoRunState(tab.id);
  if (!state?.agent) return errorResponse('Current page has no Agent checkpoint');
  state.agent = applyAgentControl(state.agent, command);
  state.status = 'running';
  state.pauseReason = undefined;
  state.message = command === 'replan_page' ? 'Agent 正在重新读取并规划本页' : 'Agent 正在重试失败项';
  await saveAutoRunState(state);
  void processAutoRun(tab.id);
  return autoRunResponse(state);
}

async function handleGetAutoRunStatus(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const state = await getAutoRunState(tab.id);
  const taskId = state?.taskId ?? await getBoundTaskId(tab.id);
  const task = taskId ? await getApplicationTask(taskId) : null;
  return autoRunResponse(state ?? {
    tabId: tab.id,
    taskId: task?.id,
    batchId: task?.batchId,
    status: 'stopped',
    pageCount: task?.pageCount ?? 0,
    filledCount: task?.filledCount ?? 0,
    message: task?.message ?? '尚未开始连续填写',
    updatedAt: Date.now(),
    history: task?.history ?? [],
  });
}

async function handleStartAutoRun(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const previous = await getAutoRunState(tab.id);
  const task = await ensureTaskForTab(tab, previous?.taskId);
  const state: AutoRunState = {
    tabId: tab.id,
    taskId: task.id,
    batchId: task.batchId,
    status: 'running',
    pageCount: previous?.status === 'paused' ? previous.pageCount : 0,
    filledCount: previous?.status === 'paused' ? previous.filledCount : 0,
    message: '后台正在填写当前页面',
    updatedAt: Date.now(),
    history: previous?.status === 'paused' ? previous.history : [],
    confirmedMaterialPageKey: previous?.confirmedMaterialPageKey,
    agent: previous?.status === 'paused' ? previous.agent : undefined,
    batchPhase: previous?.status === 'paused' ? previous.batchPhase : undefined,
    batchBlueprint: previous?.status === 'paused' ? previous.batchBlueprint : undefined,
    batchPlan: previous?.status === 'paused' ? previous.batchPlan : undefined,
  };
  await saveAutoRunState(state);
  void processAutoRun(tab.id);
  return autoRunResponse(state);
}

async function handleStopAutoRun(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const previous = await getAutoRunState(tab.id);
  const state: AutoRunState = {
    tabId: tab.id,
    taskId: previous?.taskId ?? await getBoundTaskId(tab.id),
    batchId: previous?.batchId,
    status: 'stopped',
    pageCount: previous?.pageCount ?? 0,
    filledCount: previous?.filledCount ?? 0,
    message: '已停止连续填写',
    updatedAt: Date.now(),
    history: previous?.history ?? [],
    confirmedMaterialPageKey: previous?.confirmedMaterialPageKey,
    agent: previous?.agent,
    batchPhase: previous?.batchPhase,
    batchBlueprint: previous?.batchBlueprint,
    batchPlan: previous?.batchPlan,
  };
  await saveAutoRunState(state);
  return autoRunResponse(state);
}

async function handleConfirmMaterialsAndResume(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const previous = await getAutoRunState(tab.id);
  if (!previous || previous.status !== 'paused' || previous.pauseReason !== 'materials') {
    return errorResponse('当前页面没有等待确认的上传材料');
  }
  const meta = await sendToContentScript<{ url: string; label: string; signature: string }>(tab.id, { type: 'getPageMeta' });
  previous.status = 'running';
  previous.pauseReason = undefined;
  previous.confirmedMaterialPageKey = semanticPageKey(meta);
  previous.message = '材料已由本人确认，正在核对必填项并进入下一步';
  previous.updatedAt = Date.now();
  await saveAutoRunState(previous);
  void processAutoRun(tab.id);
  return autoRunResponse(previous);
}

async function collectTabScan(
  tabId: number,
  allowAi = true,
  deferFieldAiToAgent = false,
  prepareRepeatables = true,
): Promise<ScanSuccessResponse> {
  const [textFields, blocks, apiConfig, textApiReady, fileRecords, categories] = await Promise.all([
    getAllTextFields(),
    getAllBlockCategories(),
    getApiConfig(),
    isApiConfigured(),
    getAllFileRecords(),
    getAllCategories(),
  ]);
  const readableFileRecords = await filterReadableFileRecords(fileRecords);
  const initialScan = await sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(tabId, { type: 'scan' });
  let scanResults = initialScan;
  let repeatGroups: RepeatableGroupObservation[] = [];
  let repeatRowPreparation: PrepareRepeatRowsResult = { added: 0, failures: [] };
  let repeatAgentAttempted = false;
  let repeatAgentCached = false;
  let repeatAgentReviewed = 0;
  let repeatAgentErrors: string[] = [];
  if (prepareRepeatables) {
    const excludedRepeatGroups = new Set<string>();
    const sequentialPreparation = await runSequentialRepeatPreparationPasses(async () => {
      const preparedRows = await prepareRepeatableRowScan(
        () => sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(tabId, { type: 'scan' }),
        (targets) => sendToContentScript<PrepareRepeatRowsResult>(tabId, { type: 'prepareRepeatRows', targets }),
        blocks,
        textFields,
        excludedRepeatGroups,
      );
      scanResults = preparedRows.scanResults;
      repeatRowPreparation = {
        added: repeatRowPreparation.added + preparedRows.preparation.added,
        failures: [...repeatRowPreparation.failures, ...preparedRows.preparation.failures],
      };
      repeatGroups = await sendToContentScript<RepeatableGroupObservation[]>(tabId, { type: 'observeRepeatGroups' }).catch(() => []);
      const dialogGroups = [...new Set(preparedRows.preparation.dialogGroups ?? [])];
      if (dialogGroups.length === 0) return { dialogGroups };

      const dialogPlan = planRepeatableRecords(
        scanResults.map((result) => ({ ...result.field, index: result.index })),
        blocks,
        textFields,
      );
      const targetSchemas = buildRepeatDialogTargetSchemas(
        scanResults.map((result) => ({ ...result.field, index: result.index })),
        repeatGroups,
      );
      const dialogTargets = buildRepeatDialogTargets(dialogPlan, blocks, targetSchemas)
        .filter((target) => dialogGroups.includes(target.groupLabel));
      let preparedDialogTargets = dialogTargets;
      if (dialogTargets.length > 0 && allowAi && textApiReady && apiConfig.aiEnhanced) {
        const [repeatPageMeta, repeatPageContext] = await Promise.all([
          sendToContentScript<{ label: string; url: string; signature: string }>(tabId, { type: 'getPageMeta' }),
          sendToContentScript<AgentPageSemanticContext>(tabId, { type: 'getAgentPageContext' })
            .catch(() => ({ title: '', stepText: '', visibleTexts: [], instructions: [] })),
        ]);
        preparedDialogTargets = [];
        for (const target of dialogTargets) {
          const schema = targetSchemas.find((candidate) => sameRepeatableGroupLabel(
            candidate.groupLabel,
            target.groupLabel,
          ));
          if (!schema) {
            preparedDialogTargets.push(target);
            continue;
          }
          const completedRecords: typeof target.records = [];
          for (const record of target.records) {
            const missingFields = schema.fields.filter((field) => (
              field.required
              && !field.currentValue?.trim()
              && !record.fields.find((candidate) => candidate.key === field.key)?.value.trim()
            ));
            if (missingFields.length === 0 && !schema.fields.some((field) => (
              !field.currentValue?.trim()
              && !record.fields.find((candidate) => candidate.key === field.key)?.value.trim()
            ))) {
              completedRecords.push(record);
              continue;
            }
            const completionInput = {
              pageKey: repeatPageMeta.signature || repeatPageMeta.url,
              pageUrl: repeatPageMeta.url,
              pageTitle: repeatPageContext.title || repeatPageMeta.label,
              stepText: repeatPageContext.stepText || target.groupLabel,
              instructions: repeatPageContext.instructions,
              visibleTexts: repeatPageContext.visibleTexts,
              groupLabel: target.groupLabel,
              schema,
              record,
            };
            const completion = await completeRepeatDialogRecordWithAgent(
              completionInput,
              apiConfig,
              {
                requestText: requestAgentModelDurably,
                loadPlan: async (planningInput) => {
                  const key = createAgentPlanCacheKey({
                    snapshot: planningInput.snapshot,
                    sourceRecords: planningInput.sourceRecords,
                    apiConfig,
                  });
                  const cached = await getAgentPlanCache(key);
                  if (cached) repeatAgentCached = true;
                  return cached?.plan ?? null;
                },
                savePlan: async (planningInput, plan) => {
                  const key = createAgentPlanCacheKey({
                    snapshot: planningInput.snapshot,
                    sourceRecords: planningInput.sourceRecords,
                    apiConfig,
                  });
                  await saveAgentPlanCache(key, planningInput.snapshot.pageKey, plan);
                },
              },
            );
            repeatAgentAttempted = repeatAgentAttempted || completion.attempted;
            repeatAgentReviewed += completion.reviewed;
            if (completion.error) repeatAgentErrors.push(`${target.groupLabel} 第${record.itemIndex + 1}条：${completion.error}`);
            completedRecords.push(completion.record);
          }
          preparedDialogTargets.push({ ...target, records: completedRecords });
        }
      }
      const uncoveredGroups = dialogGroups
        .filter((groupLabel) => !preparedDialogTargets.some((target) => target.groupLabel === groupLabel));
      const dialogPreparation = preparedDialogTargets.length > 0
        ? await sendToContentScript<PrepareRepeatRecordsResult>(tabId, { type: 'prepareRepeatRecords', targets: preparedDialogTargets })
        : { added: 0, processed: 0, failures: [] };
      for (const groupLabel of dialogPreparation.dismissedGroups ?? []) {
        excludedRepeatGroups.add(groupLabel);
      }
      repeatRowPreparation = {
        added: repeatRowPreparation.added + dialogPreparation.added,
        failures: [
          ...repeatRowPreparation.failures,
          ...dialogPreparation.failures.map((failure) => ({
            groupLabel: failure.groupLabel,
            reason: `${failure.presentation} record ${failure.itemIndex == null ? '' : `${failure.itemIndex + 1} `}${failure.reason}`.trim(),
          })),
          ...uncoveredGroups.map((groupLabel) => ({
            groupLabel,
            reason: 'Saved repeatable records are unavailable for the opened dialog',
          })),
        ],
      };
      scanResults = await sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(tabId, { type: 'scan' });
      return {
        dialogGroups,
        stop: Boolean(dialogPreparation.blocked) || uncoveredGroups.length > 0,
      };
    });
    if (sequentialPreparation.truncated) {
      repeatRowPreparation.failures.push({
        groupLabel: '复杂记录',
        reason: 'Dynamic record preparation exceeded the bounded sequential pass limit',
      });
    }
  } else {
    repeatGroups = await sendToContentScript<RepeatableGroupObservation[]>(tabId, { type: 'observeRepeatGroups' }).catch(() => []);
  }
  const [pageMeta, pageContext] = await Promise.all([
    sendToContentScript<{ label: string; url: string; signature: string }>(
      tabId,
      { type: 'getPageMeta' },
    ),
    sendToContentScript<AgentPageSemanticContext>(tabId, { type: 'getAgentPageContext' })
      .catch(() => ({ title: '', stepText: '', visibleTexts: [], instructions: [] })),
  ]);
  if (!scanResults?.length) {
    const repeatPlan = planRepeatableRecords([], blocks, textFields);
    return {
      ok: true,
      type: 'scan',
      total: 0,
      matched: 0,
      matches: [],
      fields: [],
      pageLabel: pageMeta?.label || '当前页面',
      pageUrl: pageMeta?.url || '',
      pageSignature: pageMeta?.signature || pageMeta?.url || '',
      applicationTitle: pageContext.title,
      stepText: pageContext.stepText || pageMeta?.label || '当前页面',
      visibleTexts: pageContext.visibleTexts,
      instructions: pageContext.instructions,
      repeatRowPreparation,
      repeatPlan,
      repeatGroups,
      ai: {
        configured: textApiReady,
        mode: apiConfig.aiEnhanced ? 'enhanced' : 'fallback',
        attempted: false,
        cached: false,
        reviewed: 0,
        error: '',
      },
    };
  }

  const fieldInfos = scanResults.map((result) => {
    const field = { ...result.field, index: result.index };
    if (field.kind === 'file') {
      field.label = materialFieldDisplayLabel(field, pageMeta?.label || '', field.index);
    }
    return field;
  });
  const repeatPlan = planRepeatableRecords(fieldInfos, blocks, textFields);
  const textFieldInfos = fieldInfos.filter((field) => field.kind !== 'file');
  const localMatches = matchFieldsLocally(textFieldInfos, textFields, blocks);
  const aiFields = deferFieldAiToAgent
    ? []
    : apiConfig.aiEnhanced
      ? textFieldInfos.filter((field) => !field.protected || /只读|锁定/.test(field.protectionReason ?? ''))
      : getAiEligibleFields(textFieldInfos, localMatches);
  const profileValues = flattenProfileValues(textFields, blocks);
  const fieldByIndex = new Map(textFieldInfos.map((field) => [field.index, field]));
  let aiMatches: MatchResult[] = [];
  let aiError = '';
  let aiAttempted = false;
  let aiCached = false;
  let materialAiReviewed = 0;
  if (allowAi && textApiReady && aiFields.length > 0 && profileValues.length > 0) {
    aiAttempted = true;
    const aiCacheKey = shortStableHash(JSON.stringify({
      tabId,
      page: pageMeta?.signature || pageMeta?.url || '',
      fields: aiFields.map((field) => fieldFingerprint(field)),
      profile: profileValues.map(({ key, value }) => [key, value]),
      api: [apiConfig.baseUrl, apiConfig.model, apiConfig.providerId, apiConfig.apiMode, apiConfig.fastMode, apiConfig.aiEnhanced],
    }));
    const cached = getCachedAiMatches(aiCacheKey);
    if (cached) {
      aiMatches = cached;
      aiCached = true;
    } else {
      try {
        aiMatches = (await aiRequestQueue.run(() => matchFields(
          aiFields,
          apiConfig,
          profileValues.map(({ key, value }) => ({ key, value })),
        )))
          .map((match) => {
            const field = fieldByIndex.get(match.index);
            return field ? { ...match, value: adaptValueToField(match.value, field) } : match;
          });
        cacheAiMatches(aiCacheKey, aiMatches);
      } catch (error) {
        aiMatches = [];
        aiError = (error instanceof Error ? error.message : 'API 调用失败').replace(/\s+/g, ' ').slice(0, 180);
      }
    }
  }
  let fileMatches = matchFileFields(fieldInfos, readableFileRecords, categories, pageMeta?.label || '');
  if (allowAi && textApiReady && fileMatches.length > 0) {
    const materialReview = await reviewFileMatchesWithAi(
      pageMeta?.signature || pageMeta?.url || '',
      fieldInfos.filter((field) => field.kind === 'file'),
      fileMatches,
      apiConfig,
    );
    fileMatches = materialReview.matches;
    aiAttempted = aiAttempted || materialReview.attempted;
    aiCached = aiCached || materialReview.cached;
    if (materialReview.error) aiError = [aiError, materialReview.error].filter(Boolean).join('；');
    materialAiReviewed = materialReview.reviewed;
  }
  const matches = [
    ...mergeLocalAndAiMatches(localMatches, aiMatches, textFieldInfos, apiConfig.aiEnhanced),
    ...fileMatches,
  ];
  return {
    ok: true,
    type: 'scan',
    total: fieldInfos.length,
    matched: matches.length,
    matches,
    fields: fieldInfos,
    pageLabel: fieldInfos.find((field) => field.groupLabel)?.groupLabel || pageMeta?.label || fieldInfos[0]?.label || '当前页面',
    pageUrl: pageMeta?.url || '',
    pageSignature: pageMeta?.signature || pageMeta?.url || '',
    applicationTitle: pageContext.title,
    stepText: pageContext.stepText || pageMeta?.label || '当前页面',
    visibleTexts: pageContext.visibleTexts,
    instructions: pageContext.instructions,
    repeatRowPreparation,
    repeatPlan,
    repeatGroups,
    ai: {
      configured: textApiReady,
      mode: apiConfig.aiEnhanced ? 'enhanced' : 'fallback',
        attempted: aiAttempted || repeatAgentAttempted,
        cached: aiCached || repeatAgentCached,
        reviewed: aiMatches.length + materialAiReviewed + repeatAgentReviewed,
        error: [aiError, ...repeatAgentErrors].filter(Boolean).join('；').slice(0, 500),
    },
  };
}

async function handleScan(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const scan = await collectTabScan(tab.id, true, true, false);
  const agentPreview = await runAgentPreviewForScan(scan);
  if (agentPreview.attempted) {
    const textFields = scan.fields.filter((field) => field.kind !== 'file');
    const localMatches = scan.matches.filter((match) => match.kind !== 'file');
    const fileMatches = scan.matches.filter((match) => match.kind === 'file');
    const aiMatches = agentPreview.matches.map((match) => ({ ...match, source: 'ai_reviewed' as const }));
    scan.matches = [
      ...mergeLocalAndAiMatches(localMatches, aiMatches, textFields, true),
      ...fileMatches,
    ];
    scan.matched = scan.matches.length;
    scan.ai = {
      ...scan.ai,
      attempted: true,
      cached: agentPreview.cached,
      reviewed: agentPreview.reviewed,
      error: agentPreview.error,
      agent: true,
      pendingActions: agentPreview.pendingActions,
      reviewItems: agentPreview.reviewItems,
    };
  }
  const task = await ensureTaskForTab(tab);
  await savePageAnalysis(
    task.id,
    scan,
    buildPageMarkers(scan),
    defaultCheckedIndexes(scan),
    scan.repeatPlan,
    tab.title || '',
  );
  return scan;
}

async function resolveContentFillItems(matches: MatchResult[]): Promise<ContentFillItem[]> {
  const fileMatches = matches.filter((match) => match.kind === 'file' && match.fileRecordId != null);
  const fileRecordById = new Map<number, FileRecord>();
  if (fileMatches.length > 0) {
    const records = await getAllFileRecords();
    for (const record of records) {
      if (record.id != null) fileRecordById.set(record.id, record);
    }
  }

  const items: ContentFillItem[] = [];
  for (const match of matches) {
    if (match.kind === 'file') {
      if (match.fileRecordId == null) continue;
      const record = fileRecordById.get(match.fileRecordId);
      if (!record) continue;
      try {
        items.push({
          kind: 'file',
          index: match.index,
          fileName: record.filename,
          fileType: inferFileType(record.filename, record.fileType),
          fileBody: arrayBufferToBase64(await record.fileBody.arrayBuffer()),
        });
      } catch {
        // Stale IndexedDB blobs can outlive their browser backing file.
      }
    } else {
      items.push({ kind: 'text', index: match.index, value: match.value, confidence: match.confidence });
    }
  }
  return items;
}

async function handleFill(
  matches: MatchResult[],
): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');

  const items = await resolveContentFillItems(matches);

  const result = await sendToContentScript<{ success: number; failure: number }>(
    tab.id,
    { type: 'fill', items },
  );

  return { ok: true, type: 'fill', success: result.success, failure: result.failure };
}

function buildPageMarkers(scan: ScanSuccessResponse): PageMarkerItem[] {
  const matchByIndex = new Map(scan.matches.map((match) => [match.index, match]));
  return scan.fields.flatMap<PageMarkerItem>((field) => {
    const match = matchByIndex.get(field.index);
    const filled = isMeaningfullyFilled(field);
    if (match?.kind === 'file') {
      return [{
        index: field.index,
        fingerprint: fieldFingerprint(field),
        status: 'review' as const,
        message: filled
          ? '保填：页面已有材料，请预览核对后确认'
          : '保填：已生成候选材料，低置信项不会自动上传',
      }];
    }
    if (match && filled) {
      const allowSystemPrefix = field.selectionMode === 'dialog' || /出生地|籍贯|学校|院校|专业/.test(field.label ?? '');
      const consistent = isPageValueConsistent(field.value, match.value, allowSystemPrefix);
      return [{
        index: field.index,
        fingerprint: fieldFingerprint(field),
        status: consistent ? 'verified' as const : 'mismatch' as const,
        message: consistent ? '保填：页面值与已保存资料一致' : '保填：页面值与已保存资料不一致',
      }];
    }
    if (match) {
      return [{
        index: field.index,
        fingerprint: fieldFingerprint(field),
        status: match.confidence === 'high' ? 'verified' as const : 'review' as const,
        message: match.confidence === 'high' ? '保填：高置信匹配，待填入' : '保填：匹配结果需要确认',
      }];
    }
    if (field.protected || filled) {
      return [{
        index: field.index,
        fingerprint: fieldFingerprint(field),
        status: 'review' as const,
        message: field.protected ? `保填：${field.protectionReason || '需本人处理'}` : '保填：页面已有值，但资料中没有可核对项',
      }];
    }
    return [];
  });
}

function upsertAutoRunHistory(state: AutoRunState, entry: AutoRunHistoryEntry): AutoRunHistoryEntry {
  const previous = state.history.at(-1);
  if (previous?.pageKey === entry.pageKey) {
    Object.assign(previous, entry);
    return previous;
  }
  state.history.push(entry);
  if (state.history.length > 20) state.history.splice(0, state.history.length - 20);
  return entry;
}

function shouldAutoFillMatch(match: MatchResult, field: FormFieldInfo | undefined): boolean {
  if (!field || match.kind === 'file' || match.confidence === 'low') return false;
  return !isMeaningfullyFilled(field);
}

async function isSamePage(tabId: number, scan: ScanSuccessResponse): Promise<boolean> {
  try {
    const current = await sendToContentScript<{ url: string; signature: string }>(
      tabId,
      { type: 'getPageMeta' },
      false,
    );
    return current.url === scan.pageUrl && current.signature === scan.pageSignature;
  } catch {
    return false;
  }
}

async function retryAutoRunAfterPageChange(state: AutoRunState): Promise<void> {
  state.message = '检测到页面已切换，已丢弃旧页结果并重新识别';
  await saveAutoRunState(state);
  if (state.taskId) await scheduleTaskResume(state.taskId, state.tabId, 500);
}

function shouldUsePageAgent(scan: ScanSuccessResponse, configured: boolean, enhanced: boolean): boolean {
  return shouldPreferPageAgent(scan.fields, scan.matches, configured, enhanced);
}

function agentInstructions(fields: FormFieldInfo[]): string[] {
  const values = fields.flatMap((field) => {
    const contextRules = (field.context ?? '').match(/[^。；;\n]{0,50}(?:日期格式|时间格式|不得|不能|禁止|最多|不超过)[^。；;\n]{0,80}/g) ?? [];
    return [field.dateFormat ?? '', field.hint ?? '', ...contextRules];
  });
  return [...new Set(values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

function buildSnapshotForAgent(
  scan: Pick<ScanSuccessResponse, 'pageSignature' | 'pageUrl' | 'pageLabel' | 'fields'> & {
    visibleTexts?: string[];
    instructions?: string[];
    applicationTitle?: string;
    stepText?: string;
    profileInstitution?: string;
    repeatGroups?: RepeatableGroupObservation[];
  },
): AgentPageSnapshot {
  const instructions = [...new Set([
    ...(scan.instructions ?? []),
    ...agentInstructions(scan.fields),
  ])];
  return buildAgentPageSnapshot({
    pageKey: scan.pageSignature,
    url: scan.pageUrl,
    title: scan.applicationTitle || scan.pageLabel,
    stepText: scan.stepText || scan.pageLabel,
    instructions,
    visibleTexts: scan.visibleTexts ?? [
      scan.pageLabel,
      ...scan.fields.flatMap((field) => [
        field.groupLabel ?? '',
        field.repeatGroup ?? '',
        field.columnLabel ?? '',
        field.label ?? '',
        field.hint ?? '',
        field.context ?? '',
        (field.value?.length ?? 0) <= 80 ? (field.value ?? '') : '',
      ]),
    ],
    profileInstitution: scan.profileInstitution,
    fields: scan.fields,
    repeatGroups: scan.repeatGroups,
  });
}

async function collectAgentBatchPages(
  state: AutoRunState,
  currentSnapshot: AgentPageSnapshot,
): Promise<AgentBatchPageInput[]> {
  if (!state.taskId) return [];
  const task = await getApplicationTask(state.taskId);
  const [blocks, textFields] = await Promise.all([
    getAllBlockCategories(),
    getAllTextFields(),
  ]);
  const snapshots = Object.values(task?.pageAnalyses ?? {})
    .map((analysis) => analysis.agentSnapshot)
    .filter((snapshot): snapshot is AgentPageSnapshot => Boolean(snapshot));
  const pageInputs = mergeAgentBatchPages([
    ...snapshots.map((snapshot) => ({ snapshot, sourceRecords: [] })),
    { snapshot: currentSnapshot, sourceRecords: [] },
  ]);
  return pageInputs.map((page) => ({
    ...page,
    sourceRecords: retrieveAgentSourceRecords(page.snapshot, blocks, textFields),
  }));
}

async function prepareAgentBatchPlanForCurrentPage(
  state: AutoRunState,
  currentSnapshot: AgentPageSnapshot,
  apiConfig: Awaited<ReturnType<typeof getApiConfig>>,
): Promise<AgentPagePlan | null> {
  const pages = await collectAgentBatchPages(state, currentSnapshot);
  if (pages.length < 2) {
    state.batchPhase = 'collecting';
    state.batchBlueprint = undefined;
    state.batchPlan = undefined;
    await saveAutoRunState(state);
    return null;
  }
  try {
    const result = await coordinateAgentBatchPlanning({
      applicationId: state.taskId || state.batchId || 'application',
      pages,
      currentPageKey: currentSnapshot.pageKey,
      existingBlueprint: state.batchBlueprint,
      existingPlan: state.batchPlan,
      capturedAt: Date.now(),
    }, {
      requestPlan: async (blueprint) => {
        state.batchPhase = 'planning';
        state.batchBlueprint = blueprint;
        state.batchPlan = undefined;
        state.message = `保填 Agent 正在综合分析 ${blueprint.pages.length} 个页面`;
        await saveAutoRunState(state);
        return requestAgentBatchPlan(blueprint, apiConfig, {
          requestText: requestAgentModelDurably,
        });
      },
    });
    state.batchPhase = result.phase;
    state.batchBlueprint = result.blueprint;
    state.batchPlan = result.plan;
    await saveAutoRunState(state);
    return result.currentPagePlan;
  } catch (error) {
    state.batchPhase = 'review';
    state.batchBlueprint = undefined;
    state.batchPlan = undefined;
    state.message = `跨页 Agent 规划未完成，本页将继续单页规划：${error instanceof Error ? error.message : '未知错误'}`
      .replace(/\s+/g, ' ')
      .slice(0, 240);
    await saveAutoRunState(state);
    return null;
  }
}

interface AgentPreviewRunResult {
  matches: MatchResult[];
  attempted: boolean;
  cached: boolean;
  reviewed: number;
  pendingActions: number;
  reviewItems: number;
  error: string;
}

function profileInstitutionFromTextFields(fields: Awaited<ReturnType<typeof getAllTextFields>>): string {
  return fields.find((field) => /^(?:学校|所在学校|本科院校|毕业院校)$/u.test(field.key.trim()))?.value?.trim() ?? '';
}

async function runAgentPreviewForScan(
  scan: ScanSuccessResponse,
): Promise<AgentPreviewRunResult> {
  const apiConfig = await getApiConfig();
  const configured = await isApiConfigured();
  const empty: AgentPreviewRunResult = {
    matches: [], attempted: false, cached: false, reviewed: 0,
    pendingActions: 0, reviewItems: 0, error: '',
  };
  if (!configured || !apiConfig.aiEnhanced || scan.fields.length === 0) return empty;

  const [blocks, textFields, fileRecords] = await Promise.all([
    getAllBlockCategories(),
    getAllTextFields(),
    getAllFileRecords(),
  ]);
  const snapshot = buildSnapshotForAgent({
    pageSignature: scan.pageSignature,
    pageUrl: scan.pageUrl,
    pageLabel: scan.pageLabel,
    fields: scan.fields,
    applicationTitle: scan.applicationTitle,
    stepText: scan.stepText,
    visibleTexts: scan.visibleTexts,
    instructions: scan.instructions,
    repeatGroups: scan.repeatGroups,
    profileInstitution: profileInstitutionFromTextFields(textFields),
  });
  const sourceRecords = retrieveAgentSourceRecords(snapshot, blocks, textFields);
  if (sourceRecords.length === 0) return { ...empty, attempted: true };

  const key = createAgentPlanCacheKey({ snapshot, sourceRecords, apiConfig });
  let plan: AgentPagePlan;
  let cached = false;
  try {
    const existing = await getAgentPlanCache(key);
    if (existing) {
      cached = true;
      plan = existing.plan;
    } else {
      plan = await requestAgentPagePlan({
        snapshot,
        sourceRecords,
        fileRecordIds: fileRecords.flatMap((record) => record.id == null ? [] : [String(record.id)]),
      }, apiConfig, { requestText: requestAgentModelDurably });
      await saveAgentPlanCache(key, snapshot.pageKey, plan);
    }
    const preview = buildAgentPreview({
      snapshot,
      sourceRecords,
      plan,
      fileRecordIds: fileRecords.flatMap((record) => record.id == null ? [] : [String(record.id)]),
    });
    return {
      matches: preview.matches,
      attempted: true,
      cached,
      reviewed: preview.matches.length + preview.reviewItems.length,
      pendingActions: preview.pendingStructureActions.length,
      reviewItems: preview.reviewItems.length,
      error: '',
    };
  } catch (error) {
    return {
      ...empty,
      attempted: true,
      error: (error instanceof Error ? error.message : 'Agent 规划失败').replace(/\s+/g, ' ').slice(0, 240),
    };
  }
}

function agentSnapshotValues(snapshot: AgentPageSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.groups.flatMap((group) => group.fields)
    .map((field) => [field.targetId, field.currentValue]));
}

function agentPlanTargetActions(plan: AgentPagePlan): Map<string, { action: AgentPlannedAction; value: string }> {
  const result = new Map<string, { action: AgentPlannedAction; value: string }>();
  for (const action of plan.actions) {
    if (action.type === 'fill_row') {
      for (const value of action.values) result.set(value.targetId, { action, value: value.value });
    } else if (action.type === 'fill_field' || action.type === 'select') {
      result.set(action.targetId, { action, value: action.value });
    }
  }
  return result;
}

interface AgentScanRunResult {
  status: 'complete' | 'paused';
  canAdvance: boolean;
  reason?: string;
  success: number;
  matches: MatchResult[];
  cached: boolean;
  reviewed: number;
}

async function runAgentForScan(
  tabId: number,
  state: AutoRunState,
  initialScan: ScanSuccessResponse,
  preplannedPlan?: AgentPagePlan | null,
): Promise<AgentScanRunResult> {
  const apiConfig = await getApiConfig();
  let currentSnapshot = buildSnapshotForAgent(initialScan);
  let cached = false;
  let reviewed = 0;
  let lastBeforeValues: Record<string, string> = agentSnapshotValues(currentSnapshot);
  let lastAfterSnapshot = currentSnapshot;
  let lastContentResults: AgentExecutionResult[] = [];
  let lastExecutionPlan: AgentPagePlan | null = null;
  let lastCommitResults: AgentActionResult[] = [];
  let lastCommittedTargets = new Set<string>();
  const filledThisRun = new Set<string>();
  let pendingPreplannedPlan = preplannedPlan ?? null;

  const observe = async (): Promise<AgentPageSnapshot> => {
    const [results, meta, pageContext, repeatGroups] = await Promise.all([
      sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(tabId, { type: 'scan' }),
      sendToContentScript<{ label: string; url: string; signature: string }>(tabId, { type: 'getPageMeta' }),
      sendToContentScript<AgentPageSemanticContext>(tabId, { type: 'getAgentPageContext' })
        .catch(() => ({ title: '', stepText: '', visibleTexts: [], instructions: [] })),
      sendToContentScript<RepeatableGroupObservation[]>(tabId, { type: 'observeRepeatGroups' }).catch(() => []),
    ]);
    currentSnapshot = buildSnapshotForAgent({
      pageSignature: meta.signature,
      pageUrl: meta.url,
      pageLabel: meta.label,
      applicationTitle: pageContext.title,
      stepText: pageContext.stepText || meta.label,
      visibleTexts: pageContext.visibleTexts,
      instructions: pageContext.instructions,
      fields: (results ?? []).map((result) => ({ ...result.field, index: result.index })),
      repeatGroups,
    });
    return currentSnapshot;
  };

  const outcome = await runAgentPage({
    observe,
    retrieve: async (snapshot) => retrieveAgentSourceRecords(
      snapshot,
      await getAllBlockCategories(),
      await getAllTextFields(),
    ),
    plan: async (snapshot, sourceRecords) => {
      const explicitBatchPlan = pendingPreplannedPlan ? {
        version: 1 as const,
        blueprintFingerprint: state.batchPlan?.blueprintFingerprint ?? '',
        pagePlans: [pendingPreplannedPlan],
        reviewItems: [],
      } : null;
      const reusableBatchPlan = findReusableAgentBatchPagePlan(
        explicitBatchPlan ?? state.batchPlan,
        snapshot,
        sourceRecords,
      );
      pendingPreplannedPlan = null;
      if (reusableBatchPlan) {
        cached = true;
        return reusableBatchPlan;
      }
      const planningRecords = state.batchBlueprint && state.batchPlan
        ? sanitizeAgentSourceRecords(sourceRecords)
        : sourceRecords;
      const key = createAgentPlanCacheKey({ snapshot, sourceRecords: planningRecords, apiConfig });
      const existing = await getAgentPlanCache(key);
      if (existing) {
        cached = true;
        if (state.batchBlueprint && state.batchPlan) {
          const refreshed = refreshAgentBatchPage(
            state.batchBlueprint,
            state.batchPlan,
            { snapshot, sourceRecords: planningRecords },
            existing.plan,
          );
          state.batchBlueprint = refreshed.blueprint;
          state.batchPlan = refreshed.plan;
          state.batchPhase = 'executing';
          await saveAutoRunState(state);
        }
        return existing.plan;
      }
      const plan = await requestAgentPagePlan({ snapshot, sourceRecords: planningRecords }, apiConfig, {
        requestText: requestAgentModelDurably,
        loadChunkPlan: async (chunk) => {
          const chunkKey = createAgentPlanCacheKey({
            snapshot: chunk.snapshot,
            sourceRecords: chunk.sourceRecords,
            apiConfig,
          });
          const record = await getAgentPlanCache(chunkKey);
          if (record) cached = true;
          return record?.plan ?? null;
        },
        saveChunkPlan: async (chunk, chunkPlan) => {
          const chunkKey = createAgentPlanCacheKey({
            snapshot: chunk.snapshot,
            sourceRecords: chunk.sourceRecords,
            apiConfig,
          });
          await saveAgentPlanCache(chunkKey, `${snapshot.pageKey}::${chunk.chunkId}`, chunkPlan);
        },
        onChunkProgress: async (completed, total) => {
          state.message = `保填 Agent 已完成 ${completed}/${total} 批页面规划`;
          await saveAutoRunState(state);
        },
      });
      await saveAgentPlanCache(key, snapshot.pageKey, plan);
      if (state.batchBlueprint && state.batchPlan) {
        const refreshed = refreshAgentBatchPage(
          state.batchBlueprint,
          state.batchPlan,
          { snapshot, sourceRecords: planningRecords },
          plan,
        );
        state.batchBlueprint = refreshed.blueprint;
        state.batchPlan = refreshed.plan;
        state.batchPhase = 'executing';
        await saveAutoRunState(state);
      }
      return plan;
    },
    validate: (plan, snapshot, sourceRecords) => {
      const previousAgentValues = Object.fromEntries((state.agent?.results ?? [])
        .filter((result) => result.targetId && (result.status === 'verified' || result.status === 'manual'))
        .map((result) => [result.targetId!, result.observed]));
      const validated = validateAgentPlan(plan, {
        snapshot,
        sourceRecords,
        observedValues: agentSnapshotValues(snapshot),
        lastAgentValues: previousAgentValues,
      });
      reviewed = validated.reviewItems.length;
      const executableTargetIds = new Set(validated.executableActions.flatMap((action) => {
        if (action.type === 'fill_row') return action.values.map((value) => value.targetId);
        if (action.type === 'fill_field' || action.type === 'select' || action.type === 'upload') {
          return [action.targetId];
        }
        return [];
      }));
      const blockingReviewItems = blockingAgentReviewItems(
        plan,
        snapshot,
        validated.reviewItems,
        new Set(validated.executableActions.map((action) => action.actionId)),
        executableTargetIds,
        sourceRecords.length > 0,
      );
      return {
        ...validated,
        plan: { ...plan, reviewItems: blockingReviewItems },
        reviewItems: blockingReviewItems,
      };
    },
    prepare: async (validated) => {
      const additions = validated.executableActions.filter((action) => action.type === 'add_rows');
      if (additions.length === 0) return { structureChanged: false, results: [] };
      const targets = additions.flatMap((action) => {
        if (action.type !== 'add_rows') return [];
        const group = currentSnapshot.groups.find((candidate) => candidate.groupId === action.groupId);
        const currentRows = Math.max(group?.rows.length ?? 0, group?.observation?.currentRowCount ?? 0);
        return group ? [{
          groupLabel: group.label,
          requiredRows: currentRows + action.count,
          missingItemIndexes: Array.from({ length: action.count }, (_, index) => currentRows + index),
        }] : [];
      });
      const prepared = targets.length > 0
        ? await sendToContentScript<PrepareRepeatRowsResult>(tabId, { type: 'prepareRepeatRows', targets })
        : { added: 0, failures: [] };
      const results = additions.map((action) => ({
        actionId: action.actionId,
        status: prepared.failures.some((failure) => (
          currentSnapshot.groups.find((group) => group.groupId === action.groupId)?.label === failure.groupLabel
        )) ? 'failed' as const : 'verified' as const,
        observed: String(prepared.added),
        reason: prepared.failures.length > 0 ? prepared.failures.map((failure) => failure.reason).join('; ') : 'rows-prepared',
        retryable: prepared.failures.length > 0,
        updatedAt: Date.now(),
      }));
      return {
        structureChanged: prepared.added > 0 || (prepared.dialogGroups?.length ?? 0) > 0,
        results,
        reason: prepared.failures.map((failure) => failure.reason).join('; ') || undefined,
      };
    },
    execute: async (validated) => {
      lastExecutionPlan = { ...validated.plan, actions: validated.executableActions };
      const batch = buildAgentExecutionBatch(lastExecutionPlan, currentSnapshot);
      lastBeforeValues = agentSnapshotValues(currentSnapshot);
      lastCommitResults = [];
      lastCommittedTargets = new Set<string>();
      if (!batch.safeToExecute) {
        lastContentResults = [
          ...batch.missingTargetIds.map((targetId) => ({
            actionId: agentPlanTargetActions(validated.plan).get(targetId)?.action.actionId ?? 'unknown',
            targetId, attempted: false, observed: '', matched: false, reason: 'target-not-found',
          })),
          ...batch.blockedTargetIds.map((targetId) => ({
            actionId: agentPlanTargetActions(validated.plan).get(targetId)?.action.actionId ?? 'unknown',
            targetId, attempted: false, observed: lastBeforeValues[targetId] ?? '', matched: false, reason: 'protected-target',
          })),
        ];
      } else {
        lastContentResults = batch.items.length > 0
          ? await sendToContentScript<AgentExecutionResult[]>(tabId, {
              type: 'executeAgentActions',
              pageKey: batch.pageKey,
              items: batch.items,
            })
          : [];
      }
      for (const result of lastContentResults) if (result.matched) filledThisRun.add(result.targetId);
      const dialogGroups = currentSnapshot.groups.filter((group) => group.observation?.dialogVisible);
      const commitDecision = decideRepeatRecordCommit({
        targetIds: batch.items.map((item) => item.targetId),
        executionResults: lastContentResults,
        visibleDialogGroups: dialogGroups.map((group) => group.label),
      });
      if (commitDecision.action === 'commit') {
          const commit = await sendToContentScript<CommitRepeatRecordResult>(tabId, {
            type: 'commitRepeatRecord',
            groupLabel: commitDecision.groupLabel,
          }).catch(() => ({
            groupLabel: commitDecision.groupLabel,
            committed: false,
            reason: 'record-commit-message-failed',
          }));
          if (commit.committed) {
            lastCommittedTargets = new Set(commitDecision.committedTargetIds);
          } else {
            lastCommitResults.push({
              actionId: batch.items[0].actionId,
              status: 'failed',
              observed: '',
              reason: `repeat-record-commit-failed:${commit.reason}`,
              retryable: true,
              updatedAt: Date.now(),
            });
          }
      } else if (commitDecision.action === 'fail') {
        lastCommitResults.push({
          actionId: batch.items[0]?.actionId ?? 'repeat-record-commit',
          status: 'failed',
          observed: '',
          reason: `repeat-record-commit-failed:${commitDecision.reason}`,
          retryable: false,
          updatedAt: Date.now(),
        });
      }
      lastAfterSnapshot = await observe();
      const executionResults: AgentActionResult[] = lastContentResults.map((result) => ({
        actionId: result.actionId,
        targetId: result.targetId,
        status: result.matched ? 'verified' : result.reason === 'manual-value-changed' ? 'manual' : 'failed',
        observed: result.observed,
        reason: result.reason,
        retryable: /target-not-found|page-changed|write-readback-mismatch/.test(result.reason),
        updatedAt: Date.now(),
      }));
      return { results: [...executionResults, ...lastCommitResults] };
    },
    verify: async (validated, report) => {
      const verificationPlan = lastExecutionPlan ?? { ...validated.plan, actions: validated.executableActions };
      const planTargets = agentPlanTargetActions(verificationPlan);
      const afterValues = agentSnapshotValues(lastAfterSnapshot);
      for (const result of lastContentResults) {
        if (lastCommittedTargets.has(result.targetId) && !afterValues[result.targetId]) {
          afterValues[result.targetId] = result.observed;
        }
      }
      const verification = verifyAgentExecution({
        plan: verificationPlan,
        snapshot: lastAfterSnapshot,
        beforeValues: lastBeforeValues,
        afterValues,
        lastAgentValues: Object.fromEntries((state.agent?.results ?? [])
          .filter((result) => result.targetId)
          .map((result) => [result.targetId!, result.observed])),
        executionResults: lastContentResults,
      });
      const results = Object.entries(verification.fieldStatuses).map(([targetId, status]) => {
        const resultStatus: AgentActionResult['status'] = status === 'empty' || status === 'planned'
          ? 'failed'
          : status;
        return {
          actionId: planTargets.get(targetId)?.action.actionId ?? 'unknown',
          targetId,
          status: resultStatus,
          observed: afterValues[targetId] ?? '',
          reason: resultStatus === 'verified' ? 'readback-verified' : resultStatus,
          retryable: resultStatus === 'failed',
          updatedAt: Date.now(),
        } satisfies AgentActionResult;
      });
      const failedActionIds = [...new Set([
        ...report.results.filter((result) => result.status === 'failed').map((result) => result.actionId),
        ...results.filter((result) => result.status === 'failed').map((result) => result.actionId),
      ])];
      const rowBlocked = verification.rowStatuses.some((row) => row.blocksAdvance);
      const allFieldStatuses = Object.fromEntries(lastAfterSnapshot.groups.flatMap((group) => group.fields)
        .map((field) => [
          field.targetId,
          verification.fieldStatuses[field.targetId] ?? (field.currentValue.trim() ? 'manual' : 'empty'),
        ]));
      const canAdvance = canAgentAdvance({
        snapshot: lastAfterSnapshot,
        nextActionLabel: '下一步',
        fieldStatuses: allFieldStatuses,
        rowStatuses: verification.rowStatuses,
      });
      return {
        results: [...report.results.filter((result) => !result.targetId), ...results],
        complete: failedActionIds.length === 0 && !rowBlocked,
        needsRepair: failedActionIds.length > 0 || rowBlocked,
        failedActionIds,
        canAdvance,
        reason: rowBlocked ? '复杂表格仍有部分行未完整填写' : failedActionIds.length > 0 ? '部分字段回读失败' : undefined,
      };
    },
    save: async (checkpoint) => {
      state.agent = checkpoint;
      await saveAutoRunState(state);
    },
  }, state.agent);

  state.agent = { ...outcome.checkpoint, cached };
  const targetActions = outcome.checkpoint.plan ? agentPlanTargetActions(outcome.checkpoint.plan) : new Map();
  const fieldsByTarget = new Map(lastAfterSnapshot.groups.flatMap((group) => group.fields)
    .map((field) => [field.targetId, field]));
  const matches = outcome.checkpoint.results.flatMap((result): MatchResult[] => {
    if (!result.targetId || (result.status !== 'verified' && result.status !== 'manual')) return [];
    const field = fieldsByTarget.get(result.targetId);
    const planned = targetActions.get(result.targetId);
    if (!field || !planned) return [];
    const action = planned.action;
    const sourceRecordId = action.type === 'fill_row' || action.type === 'fill_field' || action.type === 'select'
      ? action.sourceRecordId
      : 'agent';
    return [{
      kind: 'text',
      index: field.index,
      fieldKey: sourceRecordId,
      value: planned.value,
      shortLabel: field.label.slice(0, 12),
      confidence: result.status === 'verified' ? 'high' : 'medium',
    }];
  });
  return {
    status: outcome.status,
    canAdvance: outcome.canAdvance,
    reason: outcome.reason,
    success: filledThisRun.size,
    matches,
    cached,
    reviewed,
  };
}

async function processAutoRun(tabId: number): Promise<void> {
  if (autoRunInFlight.has(tabId)) return;
  autoRunInFlight.add(tabId);
  try {
    const state = await getAutoRunState(tabId);
    if (!state || state.status !== 'running') return;
    if (state.pageCount >= 20) {
      state.status = 'paused';
      state.message = '已连续处理 20 页，为避免误操作已暂停，请人工检查';
      await saveAutoRunState(state);
      return;
    }

    state.message = `正在处理第 ${state.pageCount + 1} 页`;
    await saveAutoRunState(state);
    if (state.pageCount > 0) {
      // Full navigations may report complete just before the new content script
      // has finished its first DOM pass. Give the page a short settling window.
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    let scan = await collectTabScan(tabId, true, true, false);
    if (scan.total === 0 && state.pageCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      scan = await collectTabScan(tabId, true, true, false);
    }
    if (!(await isSamePage(tabId, scan))) {
      await retryAutoRunAfterPageChange(state);
      return;
    }
    const markers = buildPageMarkers(scan);
    state.agent = agentCheckpointForPage(state.agent, scan.pageSignature, AGENT_PROTOCOL_VERSION);
    state.lastPageKey = semanticPageKey({
      url: scan.pageUrl,
      label: scan.pageLabel,
      signature: scan.pageSignature,
    });
    await Promise.all([
      rememberPageMarkers(tabId, {
        url: scan.pageUrl,
        label: scan.pageLabel,
        signature: scan.pageSignature,
      }, markers),
      sendToContentScript(tabId, { type: 'markPreview', items: markers }).catch(() => undefined),
    ]);
    const verifiedCount = markers.filter((marker) => marker.status === 'verified').length;
    const conflictCount = markers.filter((marker) => marker.status === 'mismatch').length;
    const historyEntry = upsertAutoRunHistory(state, {
      page: state.pageCount + 1,
      pageKey: semanticPageKey({ url: scan.pageUrl, label: scan.pageLabel, signature: scan.pageSignature }),
      label: scan.pageLabel,
      recognized: scan.total,
      matched: scan.matched,
      verified: verifiedCount,
      conflicts: conflictCount,
      filled: 0,
      aiAttempted: scan.ai.attempted,
      aiCached: scan.ai.cached,
      aiReviewed: scan.ai.reviewed,
      status: 'checked',
      message: '页面已扫描并标色',
      updatedAt: Date.now(),
    });
    await Promise.all([
      saveAutoRunState(state),
      persistScanSnapshot(state, scan),
      state.taskId
        ? savePageAnalysis(state.taskId, scan, markers, defaultCheckedIndexes(scan), scan.repeatPlan)
        : Promise.resolve(),
    ]);
    let scannedFieldByIndex = new Map(scan.fields.map((field) => [field.index, field]));
    const fileFields = scan.fields.filter((field) => field.kind === 'file');
    const currentMaterialPageKey = semanticPageKey({
      url: scan.pageUrl,
      label: scan.pageLabel,
      signature: scan.pageSignature,
    });
    if (fileFields.length > 0 && state.confirmedMaterialPageKey !== currentMaterialPageKey) {
      const safeFileMatches = scan.matches.filter((match) => {
        const field = scannedFieldByIndex.get(match.index);
        return match.kind === 'file' &&
          match.fileRecordId != null &&
          match.confidence !== 'low' &&
          Boolean(field) &&
          !isMeaningfullyFilled(field!);
      });
      const fileItems = await resolveContentFillItems(safeFileMatches);
      const uploadResult = fileItems.length > 0
        ? await sendToContentScript<{ success: number; failure: number }>(tabId, { type: 'fill', items: fileItems })
        : { success: 0, failure: 0 };
      state.filledCount += uploadResult.success;
      state.status = 'paused';
      state.pauseReason = 'materials';
      const candidateCount = scan.matches.filter((match) => match.kind === 'file' && match.fileRecordId != null).length;
      state.message = `发现 ${fileFields.length} 个上传项，已自动选择并写入 ${uploadResult.success} 项，生成 ${candidateCount} 组候选。请预览核对后确认进入下一步。`;
      historyEntry.filled = uploadResult.success;
      historyEntry.status = 'paused';
      historyEntry.message = state.message;
      historyEntry.updatedAt = Date.now();
      await Promise.all([saveAutoRunState(state), persistScanSnapshot(state, scan)]);
      return;
    }
    const [apiConfig, configured] = await Promise.all([getApiConfig(), isApiConfigured()]);
    const usePageAgent = shouldUsePageAgent(scan, configured, apiConfig.aiEnhanced);
    if (Object.values(scan.repeatPlan.groups).some((group) => group.rowsToAdd > 0)) {
      const preparedScan = await collectTabScan(tabId, true, true, true);
      if (!(await isSamePage(tabId, preparedScan))) {
        await retryAutoRunAfterPageChange(state);
        return;
      }
      scan = preparedScan;
      scannedFieldByIndex = new Map(scan.fields.map((field) => [field.index, field]));
    }
    if (scan.repeatRowPreparation.failures.length > 0) {
      state.status = 'paused';
      state.pauseReason = 'required';
      state.message = `Repeatable rows need attention: ${scan.repeatRowPreparation.failures
        .map((failure) => `${failure.groupLabel}: ${failure.reason}`)
        .join('; ')}`;
      historyEntry.status = 'paused';
      historyEntry.message = state.message;
      historyEntry.updatedAt = Date.now();
      await saveAutoRunState(state);
      return;
    }
    let result: { success: number; failure: number };
    if (usePageAgent) {
      const currentAgentSnapshot = buildSnapshotForAgent(scan);
      state.message = '保填 Agent 正在汇总已识别页面并生成当前页计划';
      historyEntry.message = state.message;
      historyEntry.updatedAt = Date.now();
      await saveAutoRunState(state);
      const preplannedPlan = await prepareAgentBatchPlanForCurrentPage(state, currentAgentSnapshot, apiConfig);
      state.message = preplannedPlan
        ? `保填 Agent 已完成 ${state.batchBlueprint?.pages.length ?? 1} 页综合规划，正在执行当前页`
        : state.batchPhase === 'collecting'
          ? '当前仅收集到一页，先按当前页完整语义规划；后续页面会加入跨页综合分析'
          : '保填 Agent 正在按当前页面的完整题干、注释和结构生成计划';
      historyEntry.message = state.message;
      historyEntry.updatedAt = Date.now();
      await saveAutoRunState(state);
      const agentRun = await runAgentForScan(tabId, state, scan, preplannedPlan);
      scan.ai.attempted = true;
      scan.ai.cached = agentRun.cached;
      scan.ai.reviewed += agentRun.reviewed;
      const agentIndexes = new Set(agentRun.matches.map((match) => match.index));
      scan.matches = [
        ...scan.matches.filter((match) => match.kind === 'file' || !agentIndexes.has(match.index)),
        ...agentRun.matches,
      ].sort((left, right) => left.index - right.index);
      scan.matched = scan.matches.length;
      historyEntry.aiAttempted = true;
      historyEntry.aiCached = agentRun.cached;
      historyEntry.aiReviewed += agentRun.reviewed;
      if (agentRun.status === 'paused') {
        const accounting = accountAgentRun(state.filledCount, agentRun.success);
        state.filledCount = accounting.totalFilled;
        historyEntry.filled = accounting.pageFilled;
        const afterResults = await sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(
          tabId,
          { type: 'scan' },
        ).catch(() => []);
        const afterFields = (afterResults ?? []).map((item) => ({ ...item.field, index: item.index }));
        const afterScan = { ...scan, fields: afterFields };
        const afterMarkers = buildPageMarkers(afterScan);
        historyEntry.verified = afterMarkers.filter((marker) => marker.status === 'verified').length;
        historyEntry.conflicts = afterMarkers.filter((marker) => marker.status === 'mismatch').length;
        state.status = 'paused';
        state.pauseReason = /LLM API error|API|502|401|403|429/i.test(agentRun.reason ?? '') ? 'error' : 'required';
        state.message = agentRun.reason || '保填 Agent 需要人工确认后继续';
        historyEntry.status = 'paused';
        historyEntry.message = state.message;
        historyEntry.updatedAt = Date.now();
        await Promise.all([
          saveAutoRunState(state),
          rememberPageMarkers(tabId, {
            url: scan.pageUrl,
            label: scan.pageLabel,
            signature: scan.pageSignature,
          }, afterMarkers),
          sendToContentScript(tabId, { type: 'markPreview', items: afterMarkers }).catch(() => undefined),
          persistScanSnapshot(state, afterScan),
          state.taskId
            ? savePageAnalysis(
                state.taskId,
                afterScan,
                afterMarkers,
                defaultCheckedIndexes(afterScan),
                scan.repeatPlan,
              )
            : Promise.resolve(),
        ]);
        return;
      }
      result = { success: agentRun.success, failure: 0 };
    } else {
      const selectedMatches = scan.matches.filter((match) => (
        shouldAutoFillMatch(match, scannedFieldByIndex.get(match.index))
      ));
      result = await sendToContentScript<{ success: number; failure: number }>(tabId, {
        type: 'fill',
        items: selectedMatches.map((match) => ({
          kind: 'text',
          index: match.index,
          value: match.value,
          confidence: match.confidence,
        })),
      });
    }
    if (!(await isSamePage(tabId, scan))) {
      if (state.history.at(-1) === historyEntry) state.history.pop();
      await retryAutoRunAfterPageChange(state);
      return;
    }
    state.filledCount += result.success;
    historyEntry.filled = result.success;
    historyEntry.message = result.success > 0 ? `已填入 ${result.success} 项并回读` : '已有内容仅核对，未覆盖';
    historyEntry.updatedAt = Date.now();

    const [afterResults, afterMeta] = await Promise.all([
      sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(tabId, { type: 'scan' }),
      sendToContentScript<{ url: string; signature: string }>(tabId, { type: 'getPageMeta' }),
    ]);
    if (afterMeta.url !== scan.pageUrl || afterMeta.signature !== scan.pageSignature) {
      state.filledCount -= result.success;
      if (state.history.at(-1) === historyEntry) state.history.pop();
      await retryAutoRunAfterPageChange(state);
      return;
    }
    const afterFields = (afterResults ?? []).map((resultItem) => ({ ...resultItem.field, index: resultItem.index }));
    const afterMarkers = buildPageMarkers({ ...scan, fields: afterFields });
    await Promise.all([
      rememberPageMarkers(tabId, {
        url: scan.pageUrl,
        label: scan.pageLabel,
        signature: scan.pageSignature,
      }, afterMarkers),
      sendToContentScript(tabId, { type: 'markPreview', items: afterMarkers }).catch(() => undefined),
      persistScanSnapshot(state, { ...scan, fields: afterFields }),
      state.taskId
        ? savePageAnalysis(
            state.taskId,
            { ...scan, fields: afterFields },
            afterMarkers,
            defaultCheckedIndexes({ ...scan, fields: afterFields }),
            scan.repeatPlan,
          )
        : Promise.resolve(),
    ]);
    historyEntry.verified = afterMarkers.filter((marker) => marker.status === 'verified').length;
    historyEntry.conflicts = afterMarkers.filter((marker) => marker.status === 'mismatch').length;
    const blockers = (afterResults ?? [])
      .map((resultItem) => ({ ...resultItem.field, index: resultItem.index }))
      .filter((field) => field.required && !isMeaningfullyFilled(field));
    if (blockers.length > 0) {
      const labels = blockers.slice(0, 3).map((field) => field.label || field.columnLabel || `字段${field.index + 1}`);
      state.status = 'paused';
      state.pauseReason = 'required';
      state.message = `本页还有 ${blockers.length} 个必填项需处理：${labels.join('、')}`;
      historyEntry.status = 'paused';
      historyEntry.message = state.message;
      historyEntry.updatedAt = Date.now();
      await saveAutoRunState(state);
      return;
    }

    state.message = '本页填写完成，正在安全进入下一步';
    state.pauseReason = undefined;
    historyEntry.message = state.message;
    historyEntry.updatedAt = Date.now();
    await saveAutoRunState(state);
    let advance: { clicked: boolean; advanced: boolean; reason: string };
    try {
      // Never replay a navigation command after its message channel disconnects:
      // the disconnect usually means the first click already opened the next page.
      advance = await sendToContentScript(tabId, { type: 'advanceToNextStep' }, false);
    } catch {
      // A full-page navigation destroys the old content-script message channel.
      // The disconnect can arrive after the new tab already reports "complete",
      // so tab.status alone is not a reliable navigation signal.
      state.pageCount++;
      state.message = '页面切换中，后台会在新页面稳定后继续填写';
      historyEntry.status = 'checked';
      historyEntry.message = '本页已核对，正在进入下一页';
      historyEntry.updatedAt = Date.now();
      await saveAutoRunState(state);
      if (state.taskId) await scheduleTaskResume(state.taskId, tabId, 700);
      return;
    }

    if (!advance.clicked) {
      state.pageCount++;
      state.status = 'complete';
      state.message = '已到最终审核页，未执行提交，请逐项核对后本人决定';
      historyEntry.status = 'complete';
      historyEntry.message = state.message;
      historyEntry.updatedAt = Date.now();
      await saveAutoRunState(state);
      return;
    }
    if (!advance.advanced) {
      state.status = 'paused';
      state.pauseReason = 'navigation';
      state.message = advance.reason;
      historyEntry.status = 'paused';
      historyEntry.message = advance.reason;
      historyEntry.updatedAt = Date.now();
      await saveAutoRunState(state);
      return;
    }

    state.pageCount++;
    state.message = '已进入下一页，后台继续填写';
    historyEntry.status = 'checked';
    historyEntry.message = '本页已核对并进入下一页';
    historyEntry.updatedAt = Date.now();
    await saveAutoRunState(state);
    if (state.taskId) await scheduleTaskResume(state.taskId, tabId, 250);
  } catch (error) {
    const state = await getAutoRunState(tabId);
    if (state?.status === 'running') {
      state.status = 'paused';
      state.pauseReason = 'error';
      state.message = error instanceof Error ? error.message : '连续填写遇到错误，已暂停';
      const historyEntry = state.history.at(-1);
      if (historyEntry) {
        historyEntry.status = 'error';
        historyEntry.message = state.message;
        historyEntry.updatedAt = Date.now();
      }
      await saveAutoRunState(state);
    }
  } finally {
    autoRunInFlight.delete(tabId);
  }
}
