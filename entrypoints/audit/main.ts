import {
  buildAuditViewModel,
  groupAuditIssues,
} from '@/utils/audit-view-model';
import type { ApplicationTask } from '@/utils/application-tasks';
import { selectDefaultAuditTaskIds } from '@/utils/application-tasks';
import type { AuditPreflight, FinalAuditReport } from '@/utils/final-audit';
import { parseFinalAuditReport } from '@/utils/final-audit';

interface SuccessResponse {
  ok: true;
  type: string;
  currentTaskId?: string;
  tasks?: ApplicationTask[];
  task?: ApplicationTask | null;
  preflight?: AuditPreflight;
  fingerprint?: string;
  report?: FinalAuditReport;
  cached?: boolean;
  degraded?: boolean;
  degradedReason?: string;
}

interface ErrorResponse { ok: false; error: string }
type RuntimeResponse = SuccessResponse | ErrorResponse;

const taskList = requiredElement('taskList');
const batchSummary = requiredElement('batchSummary');
const scopeSummary = requiredElement('scopeSummary');
const taskDetail = requiredElement('taskDetail');
const reportRoot = requiredElement('report');
const statusNotice = requiredElement('statusNotice');
const preflightModal = requiredElement('preflightModal');
const modalScope = requiredElement('modalScope');
const modalNotices = requiredElement('modalNotices');
const confirmCheckbox = requiredInput('confirmCheckbox');
const forceCheckbox = requiredInput('forceCheckbox');
const preflightButton = requiredButton('preflightButton');
const auditButton = requiredButton('auditButton');
const confirmAuditButton = requiredButton('confirmAuditButton');

let tasks: ApplicationTask[] = [];
let currentTaskId = new URLSearchParams(location.search).get('currentTaskId') || undefined;
let batchId: string | undefined;
let selectedTaskIds = new Set<string>();
let preflight: AuditPreflight | null = null;
let report: FinalAuditReport | null = null;
let busy = false;

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  return requiredElement(id) as HTMLButtonElement;
}

function requiredInput(id: string): HTMLInputElement {
  return requiredElement(id) as HTMLInputElement;
}

async function sendRuntime(type: string, payload?: unknown): Promise<SuccessResponse> {
  const response = await chrome.runtime.sendMessage({ type, payload }) as RuntimeResponse;
  if (!response?.ok) throw new Error(response?.error || '扩展后台没有返回有效结果');
  return response;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return '尚未检查';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(timestamp);
}

function statusText(status: ApplicationTask['status']): string {
  return ({
    running: '填写中', paused: '待处理', complete: '已到审核页', stopped: '已停止', archived: '已归档',
  })[status];
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return node;
}

function setNotice(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  statusNotice.hidden = !message;
  statusNotice.className = `notice ${kind}`;
  statusNotice.textContent = message;
}

function clearPreflight(): void {
  preflight = null;
  confirmCheckbox.checked = false;
  forceCheckbox.checked = false;
  confirmAuditButton.disabled = true;
}

function renderTasks(model: ReturnType<typeof buildAuditViewModel>): void {
  taskList.replaceChildren();
  if (model.tasks.length === 0) {
    taskList.append(element('p', 'empty-copy', '还没有申请任务。请先在报名网站启动连续填写。'));
    return;
  }
  for (const row of model.tasks) {
    const sourceTask = tasks.find((task) => task.id === row.id);
    const wrapper = element('article', `task-row${row.isCurrent ? ' current' : ''}`);
    const select = element('input') as HTMLInputElement;
    select.type = 'checkbox';
    select.checked = row.selected;
    select.setAttribute('aria-label', `选择 ${row.name}`);
    select.addEventListener('change', () => {
      if (select.checked) selectedTaskIds.add(row.id);
      else selectedTaskIds.delete(row.id);
      clearPreflight();
      render();
    });
    const body = element('div', 'task-row-body');
    const heading = element('div', 'task-row-heading');
    heading.append(element('strong', '', row.name));
    if (row.isCurrent) heading.append(element('span', 'current-label', '当前网站'));
    body.append(
      heading,
      element('p', 'task-state', `${statusText(row.status)} · ${row.pageCount} 个页面 · ${row.materialCount} 份材料`),
      element('p', 'task-message', row.message),
    );
    const actions = element('div', 'task-actions');
    actions.append(
      button('打开网站', 'text-button', () => { void focusTask(row.id); }),
      button('改名', 'text-button', () => { void renameApplicationTask(row.id, row.name); }),
      button('归档', 'text-button muted', () => { void archiveTask(row.id, row.name); }),
    );
    if (sourceTask?.customDisplayName) {
      actions.insertBefore(
        button('恢复自动名称', 'text-button muted', () => { void restoreAutomaticTaskName(row.id); }),
        actions.lastChild,
      );
    }
    wrapper.append(select, body, actions);
    taskList.append(wrapper);
  }
}

function metric(label: string, value: number, tone = ''): HTMLElement {
  const item = element('div', `metric ${tone}`);
  item.append(element('strong', '', String(value)), element('span', '', label));
  return item;
}

function renderTaskDetail(model: ReturnType<typeof buildAuditViewModel>): void {
  taskDetail.replaceChildren();
  const current = model.tasks.find((row) => row.isCurrent) || model.tasks[0];
  if (!current) return;
  const heading = element('div', 'detail-heading');
  const titles = element('div');
  titles.append(
    element('h3', '', current.name),
    element('p', '', `${statusText(current.status)} · 最后检查 ${formatDate(current.lastAuditAt)}`),
  );
  heading.append(titles, button('打开对应网站', 'button tertiary', () => { void focusTask(current.id); }));
  const metrics = element('div', 'metrics');
  metrics.append(
    metric('页面', current.pageCount),
    metric('字段', current.fieldCount),
    metric('一致', current.verifiedCount, 'good'),
    metric('冲突', current.conflictCount, current.conflictCount ? 'danger' : ''),
    metric('缺项', current.missingCount, current.missingCount ? 'warning' : ''),
    metric('材料待核', current.materialNeedsReview, current.materialNeedsReview ? 'warning' : ''),
  );
  taskDetail.append(heading, metrics);
}

function issueRow(title: string, detail: string, taskId?: string): HTMLElement {
  const row = element('div', 'issue-row');
  const copy = element('div');
  copy.append(element('strong', '', title), element('p', '', detail));
  row.append(copy);
  if (taskId) row.append(button('打开网站', 'text-button', () => { void focusTask(taskId); }));
  return row;
}

function reportGroup(title: string, count: number, tone: string, rows: HTMLElement[], open: boolean): HTMLElement {
  const details = element('details', `report-group ${tone}`);
  details.open = open;
  const summary = element('summary');
  summary.append(element('span', '', title), element('strong', '', String(count)));
  details.append(summary);
  const body = element('div', 'report-rows');
  if (rows.length === 0) body.append(element('p', 'empty-copy', '没有相关项目'));
  else body.append(...rows);
  details.append(body);
  return details;
}

function renderReport(): void {
  reportRoot.replaceChildren();
  if (!report) {
    const empty = element('div', 'report-empty');
    empty.append(
      element('h3', '', '尚未生成最终检查报告'),
      element('p', '', '先生成预检清单并确认发送范围。最终检查只给出问题清单，不会修改任何报名页面。'),
    );
    reportRoot.append(empty);
    return;
  }
  const grouped = groupAuditIssues(report);
  const heading = element('div', 'report-heading');
  heading.append(
    element('h3', '', '最终检查报告'),
    element('p', '', `${report.summary.critical} 个严重问题 · ${report.summary.warning} 个需确认问题 · ${grouped.unchecked.length} 个未完成检查`),
  );
  reportRoot.append(
    heading,
    reportGroup('严重问题', grouped.critical.length, 'critical', grouped.critical.map((item) => (
      issueRow(item.title, `${item.evidence}；${item.recommendation}`, item.taskId)
    )), true),
    reportGroup('需要确认', grouped.warning.length + grouped.info.length, 'warning', [...grouped.warning, ...grouped.info].map((item) => (
      issueRow(item.title, `${item.evidence}；${item.recommendation}`, item.taskId)
    )), grouped.critical.length === 0),
    reportGroup('未完成检查', grouped.unchecked.length, 'unchecked', grouped.unchecked.map((item) => (
      issueRow(item.title || '未命名项目', item.reason, item.taskId)
    )), grouped.unchecked.length > 0),
    reportGroup('已确认一致', grouped.confirmed.length, 'confirmed', grouped.confirmed.map((item) => (
      issueRow(item.title, '模型已根据本次输入核对为一致', item.taskId)
    )), false),
  );
}

function render(): void {
  const model = buildAuditViewModel(tasks, {
    currentTaskId,
    batchId,
    selectedTaskIds,
    preflight,
    confirmed: confirmCheckbox.checked,
  });
  batchSummary.textContent = `${model.batch.total} 所学校 · ${model.batch.needsReview} 所待审核 · 已选择 ${model.batch.selected} 所`;
  scopeSummary.textContent = model.preflightLabel;
  preflightButton.disabled = busy || selectedTaskIds.size === 0;
  auditButton.disabled = busy || !preflight;
  confirmAuditButton.disabled = busy || model.runDisabled;
  renderTasks(model);
  renderTaskDetail(model);
  renderReport();
}

function existingReport(): FinalAuditReport | null {
  const candidates = [
    tasks.find((task) => task.id === currentTaskId),
    ...tasks.filter((task) => selectedTaskIds.has(task.id)),
  ];
  for (const task of candidates) {
    if (!task?.audit?.report) continue;
    try { return parseFinalAuditReport(JSON.stringify(task.audit.report)); } catch { /* ignore invalid old data */ }
  }
  return null;
}

async function loadTasks(): Promise<void> {
  busy = true;
  render();
  try {
    const response = await sendRuntime('listApplicationTasks');
    tasks = response.tasks ?? [];
    currentTaskId ||= response.currentTaskId;
    const current = tasks.find((task) => task.id === currentTaskId);
    batchId = current?.batchId || tasks.filter((task) => task.status !== 'archived').sort((a, b) => b.updatedAt - a.updatedAt)[0]?.batchId;
    selectedTaskIds = new Set(batchId ? selectDefaultAuditTaskIds(tasks, batchId) : []);
    report = existingReport();
    setNotice('');
  } catch (error) {
    setNotice(error instanceof Error ? error.message : '无法读取申请任务', 'error');
  } finally {
    busy = false;
    render();
  }
}

async function createPreflight(): Promise<void> {
  busy = true;
  setNotice('正在读取页面快照与材料抽样信息…');
  render();
  try {
    const response = await sendRuntime('getAuditPreflight', { taskIds: [...selectedTaskIds] });
    preflight = response.preflight ?? null;
    if (!preflight) throw new Error('后台没有返回预检清单');
    modalScope.textContent = buildAuditViewModel(tasks, {
      currentTaskId, batchId, selectedTaskIds, preflight, confirmed: false,
    }).preflightLabel;
    modalNotices.replaceChildren();
    if (preflight.notices.length) {
      modalNotices.append(element('strong', '', '以下内容可能无法完整检查'));
      const list = element('ul');
      for (const notice of preflight.notices) list.append(element('li', '', notice));
      modalNotices.append(list);
    } else {
      modalNotices.append(element('p', '', '本次预检没有发现材料读取降级。'));
    }
    confirmCheckbox.checked = false;
    forceCheckbox.checked = false;
    preflightModal.hidden = false;
    document.body.classList.add('modal-open');
    setNotice('预检清单已生成，请确认实际发送范围。', 'success');
  } catch (error) {
    clearPreflight();
    setNotice(error instanceof Error ? error.message : '生成预检清单失败', 'error');
  } finally {
    busy = false;
    render();
  }
}

function closeModal(): void {
  preflightModal.hidden = true;
  document.body.classList.remove('modal-open');
  confirmCheckbox.checked = false;
  render();
}

async function runAudit(): Promise<void> {
  if (!preflight || !confirmCheckbox.checked) return;
  busy = true;
  closeModal();
  setNotice('最终检查进行中。其他网站的自动填写任务可以继续运行。');
  render();
  try {
    const response = await sendRuntime('runFinalAudit', {
      taskIds: [...selectedTaskIds],
      force: forceCheckbox.checked,
      confirmed: true,
    });
    if (!response.report) throw new Error('模型没有返回可用报告');
    report = response.report;
    setNotice(response.cached
      ? '输入内容没有变化，已复用本地缓存报告。'
      : response.degraded
        ? `检查完成，但部分材料已降级：${response.degradedReason || '请查看未完成检查'}`
        : '最终检查完成。请按问题清单人工核对后再决定是否提交。', 'success');
    const refreshed = await sendRuntime('listApplicationTasks');
    tasks = refreshed.tasks ?? tasks;
  } catch (error) {
    setNotice(error instanceof Error ? error.message : '最终检查失败', 'error');
  } finally {
    busy = false;
    confirmCheckbox.checked = false;
    render();
  }
}

async function focusTask(taskId: string): Promise<void> {
  try { await sendRuntime('focusApplicationTask', { taskId }); }
  catch (error) { setNotice(error instanceof Error ? error.message : '无法打开网站', 'error'); }
}

async function renameApplicationTask(taskId: string, currentName: string): Promise<void> {
  const name = prompt('自定义报名任务名称（最多 60 个字符）', currentName);
  if (name == null) return;
  try {
    await sendRuntime('renameApplicationTask', { taskId, customDisplayName: name });
    clearPreflight();
    await loadTasks();
    setNotice('任务名称已同步更新。', 'success');
  } catch (error) {
    setNotice(error instanceof Error ? error.message : '任务名称保存失败', 'error');
  }
}

async function restoreAutomaticTaskName(taskId: string): Promise<void> {
  try {
    await sendRuntime('restoreAutomaticTaskName', { taskId });
    clearPreflight();
    await loadTasks();
    setNotice('已恢复自动任务名称。', 'success');
  } catch (error) {
    setNotice(error instanceof Error ? error.message : '恢复自动名称失败', 'error');
  }
}

async function archiveTask(taskId: string, name: string): Promise<void> {
  if (!confirm(`归档“${name}”？任务记录会保留在本地，但不再进入默认审核范围。`)) return;
  try {
    await sendRuntime('archiveApplicationTask', { taskId });
    selectedTaskIds.delete(taskId);
    clearPreflight();
    await loadTasks();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : '归档失败', 'error');
  }
}

preflightButton.addEventListener('click', () => { void createPreflight(); });
auditButton.addEventListener('click', () => {
  if (!preflight) return;
  preflightModal.hidden = false;
  document.body.classList.add('modal-open');
  render();
});
confirmCheckbox.addEventListener('change', render);
confirmAuditButton.addEventListener('click', () => { void runAudit(); });
requiredButton('refreshButton').addEventListener('click', () => { void loadTasks(); });
requiredButton('closeModalButton').addEventListener('click', closeModal);
requiredButton('cancelModalButton').addEventListener('click', closeModal);
preflightModal.addEventListener('click', (event) => { if (event.target === preflightModal) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !preflightModal.hidden) closeModal(); });

void loadTasks();
