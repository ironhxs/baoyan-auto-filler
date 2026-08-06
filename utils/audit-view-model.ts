import { sortTasksForCurrentSite } from './application-tasks';
import type { ApplicationTask } from './application-tasks';
import type {
  AuditPreflight,
  FinalAuditConfirmed,
  FinalAuditIssue,
  FinalAuditReport,
  FinalAuditUnchecked,
} from './final-audit';

export interface AuditViewState {
  currentTaskId?: string;
  batchId?: string;
  selectedTaskIds: Set<string>;
  preflight?: AuditPreflight | null;
  confirmed: boolean;
}

export interface AuditTaskRow {
  id: string;
  name: string;
  status: ApplicationTask['status'];
  message: string;
  isCurrent: boolean;
  selected: boolean;
  pageCount: number;
  fieldCount: number;
  verifiedCount: number;
  conflictCount: number;
  missingCount: number;
  materialCount: number;
  materialNeedsReview: number;
  lastAuditAt?: number;
  initialUrl: string;
}

export interface AuditViewModel {
  tasks: AuditTaskRow[];
  batch: { total: number; needsReview: number; selected: number };
  preflightLabel: string;
  runDisabled: boolean;
}

export interface PopupTaskSummary {
  current: AuditTaskRow | null;
  batch: { total: number; needsReview: number };
}

export interface GroupedAuditIssues {
  critical: FinalAuditIssue[];
  warning: FinalAuditIssue[];
  info: FinalAuditIssue[];
  unchecked: FinalAuditUnchecked[];
  confirmed: FinalAuditConfirmed[];
}

function taskRow(task: ApplicationTask, state: AuditViewState): AuditTaskRow {
  const pages = task.pageOrder.map((pageId) => task.pages[pageId]).filter(Boolean);
  const fields = pages.flatMap((page) => page.fields);
  const materialNeedsReview = task.materials.filter((material) => (
    material.status === 'missing' || material.status === 'unchecked' || material.status === 'selected'
  )).length;
  return {
    id: task.id,
    name: task.displayName,
    status: task.status,
    message: task.message,
    isCurrent: task.id === state.currentTaskId,
    selected: state.selectedTaskIds.has(task.id),
    pageCount: pages.length || task.pageCount,
    fieldCount: fields.length,
    verifiedCount: fields.filter((field) => field.status === 'verified').length,
    conflictCount: fields.filter((field) => field.status === 'mismatch').length,
    missingCount: fields.filter((field) => field.status === 'unmatched' && field.required).length,
    materialCount: task.materials.length,
    materialNeedsReview,
    lastAuditAt: task.audit?.status === 'complete' ? task.audit.updatedAt : undefined,
    initialUrl: task.initialUrl,
  };
}

function rowNeedsReview(row: AuditTaskRow): boolean {
  return row.status === 'paused'
    || row.conflictCount > 0
    || row.missingCount > 0
    || row.materialNeedsReview > 0;
}

export function formatAuditPreflight(preflight?: AuditPreflight | null): string {
  if (!preflight) return '请先生成预检清单';
  return `${preflight.taskCount} 所学校 · ${preflight.pageCount} 个页面 · ${preflight.fieldCount} 个字段 · ${preflight.materialCount} 份材料 · ${preflight.sampledPageCount} 个抽样页`;
}

export function buildAuditViewModel(tasks: ApplicationTask[], state: AuditViewState): AuditViewModel {
  const visibleTasks = tasks.filter((task) => task.status !== 'archived');
  const rows = sortTasksForCurrentSite(visibleTasks, state.currentTaskId).map((task) => taskRow(task, state));
  return {
    tasks: rows,
    batch: {
      total: rows.length,
      needsReview: rows.filter(rowNeedsReview).length,
      selected: rows.filter((row) => row.selected).length,
    },
    preflightLabel: formatAuditPreflight(state.preflight),
    runDisabled: !state.confirmed || !state.preflight || state.selectedTaskIds.size === 0,
  };
}

export function buildPopupTaskSummary(tasks: ApplicationTask[], currentTaskId?: string): PopupTaskSummary {
  const currentTask = tasks.find((task) => task.id === currentTaskId && task.status !== 'archived');
  const batchId = currentTask?.batchId
    || tasks.filter((task) => task.status !== 'archived').sort((left, right) => right.updatedAt - left.updatedAt)[0]?.batchId;
  const batchTasks = tasks.filter((task) => task.status !== 'archived' && (!batchId || task.batchId === batchId));
  const state: AuditViewState = {
    currentTaskId,
    batchId,
    selectedTaskIds: new Set(),
    confirmed: false,
  };
  const rows = sortTasksForCurrentSite(batchTasks, currentTaskId).map((task) => taskRow(task, state));
  return {
    current: rows.find((row) => row.isCurrent) ?? null,
    batch: { total: rows.length, needsReview: rows.filter(rowNeedsReview).length },
  };
}

export function groupAuditIssues(report: FinalAuditReport): GroupedAuditIssues {
  return {
    critical: report.issues.filter((issue) => issue.severity === 'critical'),
    warning: report.issues.filter((issue) => issue.severity === 'warning'),
    info: report.issues.filter((issue) => issue.severity === 'info'),
    unchecked: [...report.unchecked],
    confirmed: [...report.confirmed],
  };
}
