import type {
  ApplicationPageAnalysis,
  ApplicationRunnerCheckpoint,
} from './page-analysis';
import type { AgentApplicationIdentity } from './agent/types';

export const APPLICATION_TASKS_KEY = 'applicationTasks:v1';
export const APPLICATION_TASK_BINDINGS_KEY = 'applicationTaskBindings:v1';

export type ApplicationTaskStatus = 'running' | 'paused' | 'complete' | 'stopped' | 'archived';
export type ApplicationTaskPauseReason = 'materials' | 'required' | 'navigation' | 'api' | 'page' | 'error';
export type AuditFieldStatus = 'verified' | 'review' | 'mismatch' | 'unmatched' | 'protected';

export interface ApplicationFieldSnapshot {
  index: number;
  fingerprint: string;
  label: string;
  kind: 'text' | 'file';
  type: string;
  required: boolean;
  currentValue: string;
  expectedValue?: string;
  fieldKey?: string;
  confidence?: 'high' | 'medium' | 'low';
  source?: 'local' | 'ai' | 'ai_reviewed' | 'material';
  status: AuditFieldStatus;
  protectionReason?: string;
}

export interface ApplicationMaterialSnapshot {
  id: string;
  fieldFingerprint: string;
  fieldLabel: string;
  source: 'website' | 'local' | 'metadata';
  fileRecordId?: number;
  filename: string;
  fileType?: string;
  fileSize?: number;
  downloadUrl?: string;
  websiteDisplay?: string;
  selectedPages?: number[];
  status: 'selected' | 'uploaded' | 'existing' | 'missing' | 'unchecked';
}

export interface ApplicationPageSnapshot {
  id: string;
  key: string;
  label: string;
  url: string;
  signature: string;
  capturedAt: number;
  fields: ApplicationFieldSnapshot[];
  materials: ApplicationMaterialSnapshot[];
}

export interface ApplicationTaskHistoryEntry {
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

export interface TaskAuditState {
  fingerprint: string;
  status: 'running' | 'complete' | 'error';
  report?: unknown;
  rawText?: string;
  degraded?: boolean;
  error?: string;
  updatedAt: number;
}

export interface ApplicationTask {
  id: string;
  batchId: string;
  siteOrigin: string;
  siteTitle: string;
  displayName: string;
  automaticIdentity?: AgentApplicationIdentity;
  projectOrdinal?: number;
  projectOrdinalScope?: string;
  customDisplayName?: string;
  initialUrl: string;
  status: ApplicationTaskStatus;
  pauseReason?: ApplicationTaskPauseReason;
  pageCount: number;
  filledCount: number;
  message: string;
  history: ApplicationTaskHistoryEntry[];
  pageOrder: string[];
  pages: Record<string, ApplicationPageSnapshot>;
  materials: ApplicationMaterialSnapshot[];
  pageAnalyses?: Record<string, ApplicationPageAnalysis>;
  runner?: ApplicationRunnerCheckpoint;
  audit?: TaskAuditState;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

function normalizedTaskName(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const APPLICATION_PROJECT_PARAMETER = /^(?:a|b|project(?:id)?|project_id|application(?:id)?|application_id|apply(?:id)?|apply_id|program(?:id)?|program_id|activity(?:id)?|activity_id|camp(?:id)?|camp_id|plan(?:id)?|plan_id|batch(?:id)?|batch_id|xm(?:id)?|xm_id)$/iu;

function applicationProjectUrlIdentity(value: string): { origin: string; parameters: string[] } {
  try {
    const url = new URL(value);
    const pairs: Array<[string, string]> = [];
    const collect = (params: URLSearchParams): void => {
      for (const [key, parameterValue] of params.entries()) {
        if (APPLICATION_PROJECT_PARAMETER.test(key) && parameterValue.trim()) {
          pairs.push([key.toLowerCase(), parameterValue.trim()]);
        }
      }
    };
    collect(url.searchParams);
    const hashQueryIndex = url.hash.indexOf('?');
    if (hashQueryIndex >= 0) collect(new URLSearchParams(url.hash.slice(hashQueryIndex + 1)));
    return {
      origin: url.origin,
      parameters: [...new Set(pairs.map(([key, parameterValue]) => `${key}=${parameterValue}`))].sort(),
    };
  } catch {
    return { origin: value, parameters: [] };
  }
}

export function shouldReuseApplicationTaskForUrl(task: ApplicationTask, currentUrl: string): boolean {
  const initial = applicationProjectUrlIdentity(task.initialUrl || task.siteOrigin);
  const current = applicationProjectUrlIdentity(currentUrl);
  if (initial.origin !== current.origin) return false;
  if (initial.parameters.length === 0 || current.parameters.length === 0) return true;
  return initial.parameters.length === current.parameters.length
    && initial.parameters.every((parameter, index) => parameter === current.parameters[index]);
}

function applicationTaskOrdinalScope(task: ApplicationTask): string {
  return normalizedTaskName(task.automaticIdentity?.institutionName)
    || normalizedTaskName(task.siteTitle)
    || normalizedTaskName(task.siteOrigin);
}

export function resolveApplicationTaskDisplayName(task: ApplicationTask): string {
  const custom = normalizedTaskName(task.customDisplayName);
  if (custom) return custom;
  const institution = normalizedTaskName(task.automaticIdentity?.institutionName);
  const department = normalizedTaskName(task.automaticIdentity?.departmentName);
  if (institution && department) return `${institution} · ${department}`;
  const base = institution || normalizedTaskName(task.siteTitle) || normalizedTaskName(task.siteOrigin);
  if (base && Number.isInteger(task.projectOrdinal) && Number(task.projectOrdinal) > 0) {
    return `${base} · 项目 ${task.projectOrdinal}`;
  }
  return base;
}

export function ensureStableApplicationTaskOrdinal(
  task: ApplicationTask,
  tasks: ApplicationTask[],
  now = Date.now(),
): ApplicationTask {
  const scope = applicationTaskOrdinalScope(task);
  const used = new Set(tasks
    .filter((candidate) => candidate.id !== task.id && candidate.projectOrdinalScope === scope)
    .map((candidate) => candidate.projectOrdinal)
    .filter((ordinal): ordinal is number => Number.isInteger(ordinal) && Number(ordinal) > 0));
  const currentOrdinal = task.projectOrdinal;
  const existing = task.projectOrdinalScope === scope
    && Number.isInteger(currentOrdinal)
    && Number(currentOrdinal) > 0
    && !used.has(currentOrdinal as number)
    ? currentOrdinal
    : undefined;
  let projectOrdinal = existing;
  if (projectOrdinal == null) {
    projectOrdinal = 1;
    while (used.has(projectOrdinal)) projectOrdinal += 1;
  }
  const next = {
    ...task,
    projectOrdinal,
    projectOrdinalScope: scope,
    updatedAt: Math.max(task.updatedAt, now),
  };
  return { ...next, displayName: resolveApplicationTaskDisplayName(next) };
}

export function renameApplicationTask(
  task: ApplicationTask,
  customDisplayName: string,
  now = Date.now(),
): ApplicationTask {
  const custom = normalizedTaskName(customDisplayName);
  if (!custom) throw new Error('请输入名称');
  if (Array.from(custom).length > 60) throw new Error('名称不能超过 60 个字符');
  return {
    ...task,
    customDisplayName: custom,
    displayName: custom,
    updatedAt: Math.max(task.updatedAt, now),
    lastOpenedAt: Math.max(task.lastOpenedAt, now),
  };
}

export function restoreAutomaticApplicationTaskName(
  task: ApplicationTask,
  now = Date.now(),
): ApplicationTask {
  const { customDisplayName: _removed, ...rest } = task;
  const next: ApplicationTask = {
    ...rest,
    updatedAt: Math.max(task.updatedAt, now),
    lastOpenedAt: Math.max(task.lastOpenedAt, now),
  };
  return { ...next, displayName: resolveApplicationTaskDisplayName(next) };
}

function clonePageAnalysis(analysis: ApplicationPageAnalysis): ApplicationPageAnalysis {
  return {
    ...analysis,
    fields: analysis.fields.map((field) => ({
      ...field,
      ...(field.options ? { options: [...field.options] } : {}),
    })),
    matches: analysis.matches.map((match) => ({
      ...match,
      ...(match.fileCandidates
        ? { fileCandidates: match.fileCandidates.map((candidate) => ({ ...candidate })) }
        : {}),
    })),
    markers: analysis.markers.map((marker) => ({ ...marker })),
    checkedIndexes: [...analysis.checkedIndexes],
    repeatPlan: {
      groups: Object.fromEntries(Object.entries(analysis.repeatPlan.groups).map(([key, group]) => [key, {
        ...group,
        rowBindings: [...group.rowBindings],
        missingItemIndexes: [...group.missingItemIndexes],
        unmatchedRowIndexes: [...group.unmatchedRowIndexes],
      }])),
    },
    ai: { ...analysis.ai },
    ...(analysis.agentSnapshot ? { agentSnapshot: structuredClone(analysis.agentSnapshot) } : {}),
  };
}

function cloneRunnerCheckpoint(checkpoint: ApplicationRunnerCheckpoint): ApplicationRunnerCheckpoint {
  return {
    ...checkpoint,
    history: checkpoint.history.map((entry) => ({ ...entry })),
    ...(checkpoint.agent ? { agent: structuredClone(checkpoint.agent) } : {}),
    ...(checkpoint.batchBlueprint ? { batchBlueprint: structuredClone(checkpoint.batchBlueprint) } : {}),
    ...(checkpoint.batchPlan ? { batchPlan: structuredClone(checkpoint.batchPlan) } : {}),
    ...(checkpoint.pageDiscovery ? { pageDiscovery: structuredClone(checkpoint.pageDiscovery) } : {}),
  };
}

/** A task can be resumed only while its durable runner explicitly remains running. */
export function canResumeRunner(checkpoint: ApplicationRunnerCheckpoint | undefined): boolean {
  return checkpoint?.status === 'running';
}

export function upsertTaskPageAnalysis(
  task: ApplicationTask,
  analysis: ApplicationPageAnalysis,
): ApplicationTask {
  const allAnalyses = {
    ...Object.fromEntries(Object.entries(task.pageAnalyses ?? {}).map(([key, value]) => [key, clonePageAnalysis(value)])),
    [analysis.pageKey]: clonePageAnalysis(analysis),
  };
  const pageAnalyses = Object.fromEntries(
    Object.entries(allAnalyses)
      .sort(([, left], [, right]) => right.capturedAt - left.capturedAt || left.pageKey.localeCompare(right.pageKey))
      .slice(0, 30),
  );
  return {
    ...task,
    pageAnalyses,
    updatedAt: Math.max(task.updatedAt, analysis.capturedAt),
    lastOpenedAt: Math.max(task.lastOpenedAt, analysis.capturedAt),
  };
}

export function getTaskPageAnalysis(
  task: ApplicationTask,
  pageKey: string,
): ApplicationPageAnalysis | null {
  const analysis = task.pageAnalyses?.[pageKey];
  return analysis ? clonePageAnalysis(analysis) : null;
}

export function updateTaskRunnerCheckpoint(
  task: ApplicationTask,
  checkpoint: ApplicationRunnerCheckpoint,
): ApplicationTask {
  return {
    ...task,
    runner: cloneRunnerCheckpoint(checkpoint),
    updatedAt: Math.max(task.updatedAt, checkpoint.updatedAt),
    lastOpenedAt: Math.max(task.lastOpenedAt, checkpoint.updatedAt),
  };
}

export interface CreateApplicationTaskInput {
  id: string;
  batchId: string;
  siteOrigin: string;
  siteTitle: string;
  displayName?: string;
  initialUrl?: string;
  page?: ApplicationPageSnapshot;
  now: number;
}

export interface AutoRunTaskUpdate {
  status: Exclude<ApplicationTaskStatus, 'archived'>;
  pauseReason?: ApplicationTaskPauseReason;
  pageCount: number;
  filledCount: number;
  message: string;
  history: ApplicationTaskHistoryEntry[];
  updatedAt: number;
}

export type ApplicationTaskBindings = Record<string, string>;

function clonePageMap(page?: ApplicationPageSnapshot): Record<string, ApplicationPageSnapshot> {
  return page ? { [page.id]: page } : {};
}

export function createApplicationTask(input: CreateApplicationTaskInput): ApplicationTask {
  const title = input.siteTitle.trim() || input.siteOrigin;
  return {
    id: input.id,
    batchId: input.batchId,
    siteOrigin: input.siteOrigin,
    siteTitle: title,
    displayName: input.displayName?.trim() || title,
    initialUrl: input.initialUrl || input.page?.url || input.siteOrigin,
    status: 'stopped',
    pageCount: 0,
    filledCount: 0,
    message: '尚未开始连续填写',
    history: [],
    pageOrder: input.page ? [input.page.id] : [],
    pages: clonePageMap(input.page),
    materials: input.page?.materials ? [...input.page.materials] : [],
    createdAt: input.now,
    updatedAt: input.now,
    lastOpenedAt: input.now,
  };
}

export function updateTaskApplicationIdentity(
  task: ApplicationTask,
  identity: AgentApplicationIdentity,
  now = Date.now(),
): ApplicationTask {
  if (!identity.institutionName && !identity.departmentName && !identity.projectName) return task;
  const next: ApplicationTask = {
    ...task,
    siteTitle: identity.institutionName || task.siteTitle,
    automaticIdentity: { ...identity },
    updatedAt: Math.max(task.updatedAt, now),
    lastOpenedAt: Math.max(task.lastOpenedAt, now),
  };
  return { ...next, displayName: resolveApplicationTaskDisplayName(next) };
}

export function upsertTaskPage(task: ApplicationTask, page: ApplicationPageSnapshot): ApplicationTask {
  const pageOrder = task.pageOrder.includes(page.id)
    ? [...task.pageOrder]
    : [...task.pageOrder, page.id];
  const pages = { ...task.pages, [page.id]: page };
  const materialById = new Map(task.materials.map((material) => [material.id, material]));
  for (const material of page.materials) materialById.set(material.id, material);
  return {
    ...task,
    pageOrder,
    pages,
    materials: [...materialById.values()],
    updatedAt: Math.max(task.updatedAt, page.capturedAt),
    lastOpenedAt: Math.max(task.lastOpenedAt, page.capturedAt),
  };
}

export function updateTaskFromAutoRun(task: ApplicationTask, update: AutoRunTaskUpdate): ApplicationTask {
  if (task.status === 'archived') return task;
  return {
    ...task,
    status: update.status,
    pauseReason: update.pauseReason,
    pageCount: update.pageCount,
    filledCount: update.filledCount,
    message: update.message,
    history: update.history.map((entry) => ({ ...entry })),
    updatedAt: update.updatedAt,
    lastOpenedAt: update.updatedAt,
  };
}

export function sortTasksForCurrentSite(tasks: ApplicationTask[], currentTaskId?: string): ApplicationTask[] {
  return [...tasks].sort((left, right) => {
    if (left.id === currentTaskId && right.id !== currentTaskId) return -1;
    if (right.id === currentTaskId && left.id !== currentTaskId) return 1;
    return right.updatedAt - left.updatedAt || left.displayName.localeCompare(right.displayName, 'zh-CN');
  });
}

export function selectDefaultAuditTaskIds(tasks: ApplicationTask[], batchId: string): string[] {
  return tasks
    .filter((task) => task.batchId === batchId && (task.status === 'paused' || task.status === 'complete'))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((task) => task.id);
}

export function bindTaskToTab(
  bindings: ApplicationTaskBindings,
  tabId: number,
  taskId: string,
): ApplicationTaskBindings {
  return { ...bindings, [String(tabId)]: taskId };
}

export function unbindTaskFromTab(bindings: ApplicationTaskBindings, tabId: number): ApplicationTaskBindings {
  const next = { ...bindings };
  delete next[String(tabId)];
  return next;
}

export function createApplicationTaskId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createApplicationBatchId(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `batch-${year}${month}${day}`;
}

type ApplicationTaskMap = Record<string, ApplicationTask>;
let taskWriteChain: Promise<unknown> = Promise.resolve();

async function readTaskMap(): Promise<ApplicationTaskMap> {
  const result = await chrome.storage.local.get(APPLICATION_TASKS_KEY);
  const stored = result[APPLICATION_TASKS_KEY];
  return stored && typeof stored === 'object' ? stored as ApplicationTaskMap : {};
}

export async function getApplicationTasks(): Promise<ApplicationTask[]> {
  await taskWriteChain.catch(() => undefined);
  return Object.values(await readTaskMap());
}

export async function getApplicationTask(taskId: string): Promise<ApplicationTask | null> {
  await taskWriteChain.catch(() => undefined);
  return (await readTaskMap())[taskId] ?? null;
}

export function saveApplicationTask(task: ApplicationTask): Promise<void> {
  const operation = taskWriteChain.then(async () => {
    const tasks = await readTaskMap();
    tasks[task.id] = ensureStableApplicationTaskOrdinal(task, Object.values(tasks));
    await chrome.storage.local.set({ [APPLICATION_TASKS_KEY]: tasks });
  });
  taskWriteChain = operation.catch(() => undefined);
  return operation;
}

export function updateApplicationTask(
  taskId: string,
  updater: (task: ApplicationTask) => ApplicationTask,
): Promise<ApplicationTask | null> {
  let updated: ApplicationTask | null = null;
  const operation = taskWriteChain.then(async () => {
    const tasks = await readTaskMap();
    const current = tasks[taskId];
    if (!current) return;
    updated = ensureStableApplicationTaskOrdinal(updater(current), Object.values(tasks));
    tasks[taskId] = updated;
    await chrome.storage.local.set({ [APPLICATION_TASKS_KEY]: tasks });
  });
  taskWriteChain = operation.catch(() => undefined);
  return operation.then(() => updated);
}

export async function archiveApplicationTask(taskId: string, now = Date.now()): Promise<ApplicationTask | null> {
  return updateApplicationTask(taskId, (task) => ({
    ...task,
    status: 'archived',
    message: '任务已归档',
    updatedAt: now,
  }));
}
