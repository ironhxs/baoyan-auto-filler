import './style.css';
import { isApiConfigured } from '@/utils/storage';
import { getAllBlockCategories, getAllFileRecords, getAllTextFields } from '@/utils/db';
import type { FileRecord } from '@/utils/db';
import type { MatchResult, FormFieldInfo } from '@/utils/matcher';
import { flattenProfileValues, PROFILE_SECTIONS } from '@/utils/profile-schema';
import type { ProfileSourceValue } from '@/utils/profile-schema';
import { isMeaningfullyFilled } from '@/utils/local-matcher';
import { isPageValueConsistent } from '@/utils/value-compare';
import { fieldFingerprint } from '@/utils/field-fingerprint';
import type { ApplicationTask } from '@/utils/application-tasks';
import type { ApplicationPageAnalysis } from '@/utils/page-analysis';
import type { RepeatableRecordPlan } from '@/utils/repeatable-records';
import { buildPopupTaskSummary } from '@/utils/audit-view-model';
import { buildAgentViewModel } from '@/utils/agent/view-model';
import { materialFieldDisplayLabel } from '@/utils/material-field-context';
import { computeMaterialReviewState } from '@/utils/material-review';

const app = document.getElementById('app')!;

interface ScanResponse {
  ok: true;
  type: 'scan';
  total: number;
  matched: number;
  matches: MatchResult[];
  fields: FormFieldInfo[];
  pageLabel: string;
  pageUrl: string;
  pageSignature: string;
  repeatPlan: RepeatableRecordPlan;
  checkedIndexes?: number[];
  ai: {
    configured: boolean;
    mode: 'enhanced' | 'fallback';
    attempted: boolean;
    cached?: boolean;
    reviewed: number;
    error: string;
  };
}

interface CurrentPageAnalysisResponse {
  ok: true;
  type: 'pageAnalysis';
  analysis: ApplicationPageAnalysis | null;
  currentPageKey: string;
}

interface ErrorResponse {
  ok: false;
  error: string;
}

interface FillResponse {
  ok: true;
  type: 'fill';
  success: number;
  failure: number;
}

interface InspectResponse {
  ok: true;
  type: 'inspect';
  total: number;
  required: number;
  unfilled: number;
  protected: number;
}

interface AutoRunResponse {
  ok: true;
  type: 'autoRun';
  tabId: number;
  taskId?: string;
  batchId?: string;
  status: 'running' | 'paused' | 'complete' | 'stopped';
  pageCount: number;
  filledCount: number;
  message: string;
  updatedAt: number;
  pauseReason?: 'materials' | 'required' | 'navigation' | 'error';
  history: Array<{
    page: number;
    label: string;
    recognized: number;
    matched: number;
    verified: number;
    conflicts: number;
    filled: number;
    aiAttempted: boolean;
    aiCached?: boolean;
    aiReviewed: number;
    status: 'checked' | 'paused' | 'complete' | 'error';
    message: string;
    updatedAt: number;
  }>;
}

interface ExistingMaterialPreviewResponse {
  ok: true;
  type: 'existingMaterialPreview';
  dataUrl: string;
  mimeType: string;
  evidence: string;
}

interface ApplicationTaskListResponse {
  ok: true;
  type: 'applicationTasks';
  currentTaskId?: string;
  tasks: ApplicationTask[];
}

type ViewState = 'idle' | 'scanning' | 'result' | 'filling' | 'filled';
type Confidence = MatchResult['confidence'];

interface DisplayItem {
  kind: 'text' | 'file';
  index: number;
  label: string;
  value: string;
  status: 'matched' | 'pending' | 'verified' | 'conflict' | 'filled' | 'unmatched' | 'protected';
  confidence?: Confidence;
  fillMode?: 'short' | 'long';
  checked: boolean;
  match?: MatchResult;
}

// State
let viewState: ViewState = 'idle';
let displayItems: DisplayItem[] = [];
let fields: FormFieldInfo[] = [];
let profileValues: ProfileSourceValue[] = [];
let pageStatus: InspectResponse | null = null;
let apiAvailable = false;
let autoRunStatus: AutoRunResponse | null = null;
let materialFileRecords: FileRecord[] = [];
const previewedMaterialByField = new Map<number, number>();
const previewedExistingMaterialFields = new Set<number>();
let lastFillIncludedFiles = false;
let applicationTasks: ApplicationTask[] = [];
let currentTaskId: string | undefined;
let currentScan: ScanResponse | null = null;

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(response);
    });
  });
}

async function init() {
  const [textFields, blocks, apiReady, fileRecords] = await Promise.all([
    getAllTextFields(),
    getAllBlockCategories(),
    isApiConfigured(),
    getAllFileRecords(),
  ]);
  profileValues = flattenProfileValues(textFields, blocks);
  apiAvailable = apiReady;
  materialFileRecords = fileRecords;

  renderHeader();

  let restoredScan: ScanResponse | null = null;
  try {
    const inspected = await sendRuntimeMessage<InspectResponse | ErrorResponse>({ type: 'inspectPage' });
    const [autoStatus, taskListResponse, pageAnalysisResponse] = await Promise.all([
      sendRuntimeMessage<AutoRunResponse | ErrorResponse>({ type: 'getAutoRunStatus' }),
      sendRuntimeMessage<ApplicationTaskListResponse | ErrorResponse>({ type: 'listApplicationTasks' }),
      sendRuntimeMessage<CurrentPageAnalysisResponse | ErrorResponse>({ type: 'getCurrentPageAnalysis' }),
    ]);
    pageStatus = inspected.ok ? inspected as InspectResponse : null;
    autoRunStatus = autoStatus.ok ? autoStatus as AutoRunResponse : null;
    if (taskListResponse.ok) {
      applicationTasks = taskListResponse.tasks;
      currentTaskId = taskListResponse.currentTaskId;
    }
    if (pageAnalysisResponse.ok && pageAnalysisResponse.analysis &&
        pageAnalysisResponse.currentPageKey === pageAnalysisResponse.analysis.pageKey) {
      const analysis = pageAnalysisResponse.analysis;
      restoredScan = {
        ok: true,
        type: 'scan',
        total: analysis.fields.length,
        matched: analysis.matches.length,
        fields: analysis.fields,
        matches: analysis.matches,
        pageLabel: analysis.pageLabel,
        pageUrl: analysis.pageUrl,
        pageSignature: analysis.pageSignature,
        repeatPlan: analysis.repeatPlan,
        checkedIndexes: analysis.checkedIndexes,
        ai: analysis.ai,
      };
    }
  } catch {
    pageStatus = null;
    autoRunStatus = null;
  }

  const hasMaterials = fileRecords.length > 0;
  if (restoredScan) {
    renderResult(restoredScan);
    return;
  }

  if (profileValues.length === 0 && !hasMaterials) {
    renderNotConfigured(true);
    return;
  }

  if (isMaterialReviewPause(autoRunStatus)) {
    startScan();
    return;
  }
  renderIdle(apiReady);
}

async function refreshApplicationTasks(): Promise<void> {
  const response = await sendRuntimeMessage<ApplicationTaskListResponse | ErrorResponse>({ type: 'listApplicationTasks' });
  if (!response.ok) return;
  applicationTasks = response.tasks;
  currentTaskId = response.currentTaskId;
}

function isMaterialReviewPause(status: AutoRunResponse | null): boolean {
  return Boolean(status?.status === 'paused' && (
    status.pauseReason === 'materials' || /上传|材料|附件/.test(status.message)
  ));
}

function renderHeader() {
  const header = document.createElement('div');
  header.className = 'header';
  header.innerHTML = `
    <div class="header-left">
      <img class="logo-icon" src="/icon/32.png" alt="保填" />
      <span class="logo-text">保填</span>
    </div>
    <div class="header-right">
      <button class="avatar-btn" id="avatarBtn" title="工作台">用</button>
      <button class="close-btn" id="closeBtn" title="关闭">&times;</button>
    </div>
  `;
  app.appendChild(header);

  document.getElementById('avatarBtn')!.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('closeBtn')!.addEventListener('click', () => {
    window.close();
  });
}

function getMainContainer(needFooter: boolean): HTMLElement {
  let main = app.querySelector<HTMLElement>('.main');
  if (!main) {
    main = document.createElement('div');
    main.className = 'main';
    app.appendChild(main);
  }
  main.className = needFooter ? 'main has-footer' : 'main no-footer';
  main.innerHTML = '';
  return main;
}

function renderNotConfigured(needProfile: boolean) {
  const main = getMainContainer(false);
  main.innerHTML = `
    <div class="not-configured">
      <div class="icon">⚙️</div>
      <p>${needProfile ? '请先在工作台录入个人信息' : '请先在工作台配置 API Key'}</p>
      <span class="settings-link" id="goSettings">前往工作台</span>
    </div>
  `;
  document.getElementById('goSettings')!.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderModeTabs(active: 'smart' | 'manual'): string {
  return `
    <div class="mode-tabs">
      <button class="mode-tab${active === 'smart' ? ' active' : ''}" id="smartModeTab">智能填充</button>
      <button class="mode-tab${active === 'manual' ? ' active' : ''}" id="manualModeTab">手动速填</button>
    </div>
  `;
}

function bindModeTabs(): void {
  document.getElementById('smartModeTab')?.addEventListener('click', () => renderIdle(apiAvailable));
  document.getElementById('manualModeTab')?.addEventListener('click', renderManualFill);
}

function renderAutoRunHistory(status: AutoRunResponse): string {
  const history = status.history ?? [];
  if (!history.length) return '';
  const statusText = { checked: '已核对', paused: '已暂停', complete: '已完成', error: '异常' } as const;
  const rows = history.map((entry) => `
    <div class="auto-history-row ${entry.status}">
      <span class="auto-history-dot"></span>
      <div class="auto-history-main">
        <div class="auto-history-label">
          <strong>${escapeHtml(entry.label || `第 ${entry.page} 页`)}</strong>
          <em>${statusText[entry.status]}</em>
        </div>
        <span>识别 ${entry.recognized} · 一致 ${entry.verified} · 冲突 ${entry.conflicts} · 填入 ${entry.filled}${entry.aiAttempted ? ` · AI ${entry.aiReviewed}${entry.aiCached ? '（缓存）' : ''}` : ''}</span>
        <small>${escapeHtml(entry.message)}</small>
      </div>
    </div>
  `).join('');
  return `<details class="auto-history" open><summary class="auto-history-title">本次逐页记录（${history.length} 页）</summary><div class="auto-history-list">${rows}</div></details>`;
}

function auditSummary(task: ApplicationTask | undefined): string {
  const summary = task?.audit?.report && typeof task.audit.report === 'object'
    ? (task.audit.report as { summary?: { critical?: unknown; warning?: unknown } }).summary
    : undefined;
  if (!summary) return '尚未执行最终检查';
  const critical = typeof summary.critical === 'number' ? summary.critical : 0;
  const warning = typeof summary.warning === 'number' ? summary.warning : 0;
  return `${critical} 个严重问题 · ${warning} 个需确认问题`;
}

function renderAgentTaskPanel(task: ApplicationTask | undefined): string {
  const checkpoint = task?.runner?.agent;
  const view = buildAgentViewModel(checkpoint);
  if (!checkpoint || !view) return '';
  const actionLabels = {
    add_rows: '新增表格行',
    fill_field: '填写字段',
    fill_row: '整行填写',
    select: '选择选项',
    upload: '匹配材料',
  } as const;
  const actionCounts = new Map<string, number>();
  for (const action of checkpoint.plan?.actions ?? []) {
    const label = actionLabels[action.type];
    actionCounts.set(label, (actionCounts.get(label) ?? 0) + 1);
  }
  const planRows = [...actionCounts.entries()]
    .map(([label, count]) => `<span>${escapeHtml(label)} <b>${count}</b></span>`)
    .join('');
  const issueTargetId = checkpoint.results.find((result) => (
    result.targetId && (result.status === 'failed' || result.status === 'review')
  ))?.targetId;
  return `
    <section class="agent-task-panel ${view.phaseTone}">
      <div class="agent-task-head">
        <div><strong>保填 Agent 2.0</strong><span>页面级理解 · 整行执行 · 写后回读</span></div>
        <em>${escapeHtml(view.phaseLabel)}</em>
      </div>
      <div class="agent-task-meta">
        <span>计划 ${view.planned} 项</span>
        ${view.cached ? '<span class="cache">已复用本页计划</span>' : '<span>本页新计划</span>'}
        ${view.retries ? `<span>已修复 ${view.retries} 次</span>` : ''}
      </div>
      <div class="agent-task-metrics">
        <span><b>${view.verified}</b>回读一致</span>
        <span><b>${view.manual}</b>保留手工</span>
        <span class="${view.review || view.pendingReview ? 'warning' : ''}"><b>${view.review + view.pendingReview}</b>待确认</span>
        <span class="${view.failed ? 'danger' : ''}"><b>${view.failed}</b>失败</span>
      </div>
      ${view.error ? `<p class="agent-task-error">${escapeHtml(view.error)}</p>` : ''}
      <details class="agent-plan-summary">
        <summary>查看本页 Agent 计划</summary>
        <div>${planRows || '<span>正在生成安全计划</span>'}</div>
        <small>这里只展示动作类别和数量，不展示个人资料值或模型原始响应。</small>
      </details>
      <div class="agent-task-actions">
        ${issueTargetId ? '<button type="button" id="locateAgentIssueBtn">定位问题字段</button>' : ''}
        ${view.canRetry ? '<button type="button" id="retryAgentBtn">重试失败项</button>' : ''}
        ${view.canReplan ? '<button type="button" id="replanAgentBtn">重新规划本页</button>' : ''}
        ${task?.status === 'running' || task?.status === 'paused' ? '<button type="button" id="stopTaskAgentBtn" class="danger">停止任务</button>' : ''}
      </div>
    </section>
  `;
}

function renderCurrentTaskSummary(): string {
  const summary = buildPopupTaskSummary(applicationTasks, currentTaskId);
  const current = summary.current;
  const task = applicationTasks.find((item) => item.id === current?.id);
  const latestPageId = task?.pageOrder.at(-1);
  const latestPage = latestPageId ? task?.pages[latestPageId] : undefined;
  const statusLabel = current ? ({
    running: '填写中', paused: '待处理', complete: '已到审核页', stopped: '已停止', archived: '已归档',
  })[current.status] : '';
  const currentHtml = current ? `
    <section class="current-task-summary">
      <div class="current-task-head">
        <div><span>当前网站</span><strong>${escapeHtml(current.name)}</strong></div>
        <em class="task-state-${current.status}">${statusLabel}</em>
      </div>
      <div class="current-page-name">${escapeHtml(latestPage?.label || task?.history.at(-1)?.label || '当前页面')}</div>
      <div class="current-task-metrics">
        <span><b>${current.pageCount}</b>页面</span>
        <span><b>${current.verifiedCount}</b>一致</span>
        <span class="${current.conflictCount ? 'danger' : ''}"><b>${current.conflictCount}</b>冲突</span>
        <span class="${current.missingCount ? 'warning' : ''}"><b>${current.missingCount}</b>缺项</span>
        <span class="${current.materialNeedsReview ? 'warning' : ''}"><b>${current.materialNeedsReview}</b>材料待核</span>
      </div>
      <div class="last-audit-summary"><span>上次最终检查</span><strong>${escapeHtml(auditSummary(task))}</strong></div>
      ${renderAgentTaskPanel(task)}
    </section>
  ` : '<section class="current-task-summary empty"><strong>当前网站尚未建立连续填写任务</strong><span>单页识别和快速填充仍可直接使用</span></section>';
  if (summary.batch.total === 0) return currentHtml;
  return `${currentHtml}
    <div class="batch-audit-summary">
      <span>本批次 ${summary.batch.total} 所学校 · ${summary.batch.needsReview} 所待审核</span>
      <button type="button" id="openAuditCenterBtn">打开统一审核</button>
    </div>`;
}

function renderIdle(apiReady = true) {
  viewState = 'idle';
  removeFooter();
  const main = getMainContainer(false);
  const statusHtml = pageStatus ? `
    <div class="site-status-card">
      <div class="site-status-title"><span class="status-live-dot"></span>当前页面已识别</div>
      <div class="site-status-grid">
        <span><b>${pageStatus.total}</b> 可填字段</span>
        <span><b>${pageStatus.required}</b> 必填字段</span>
        <span><b>${pageStatus.unfilled}</b> 尚未填写</span>
        <span><b>${pageStatus.protected}</b> 人工处理</span>
      </div>
    </div>
  ` : '<div class="site-status-card unavailable">当前页面暂时无法识别，请刷新页面后重试。</div>';
  const autoHtml = autoRunStatus && autoRunStatus.status !== 'stopped' ? `
    <div class="auto-run-card ${autoRunStatus.status}">
      <div class="auto-run-head">
        <strong>${autoRunStatus.status === 'running' ? '后台连续填写中' : autoRunStatus.status === 'paused' ? '连续填写已暂停' : '已到最终审核页'}</strong>
        <span>${autoRunStatus.pageCount} 页 · ${autoRunStatus.filledCount} 项</span>
      </div>
      <p>${escapeHtml(autoRunStatus.message)}</p>
      ${renderAutoRunHistory(autoRunStatus)}
      ${autoRunStatus.status === 'running'
        ? '<button id="stopAutoRunBtn" class="auto-run-link danger">停止</button>'
        : autoRunStatus.status === 'paused'
          ? isMaterialReviewPause(autoRunStatus)
            ? '<button id="reviewMaterialsBtn" class="auto-run-link">查看并确认材料</button>'
            : '<button id="resumeAutoRunBtn" class="auto-run-link">处理后继续</button>'
          : ''}
    </div>
  ` : '';
  main.innerHTML = `
    ${renderModeTabs('smart')}
    ${renderCurrentTaskSummary()}
    ${statusHtml}
    ${autoHtml}
    <div class="scan-card">
      <div class="scan-icon-wrap">⚡</div>
      <div class="scan-title">快速填充当前页面</div>
      <div class="scan-desc">先预览匹配结果，再由你确认填入。${apiReady ? 'AI 可辅助处理低置信字段。' : '未配置 AI 时仍可使用本地明确匹配。'}</div>
      <button class="scan-btn" id="scanBtn">识别并预览</button>
      <button class="scan-btn auto-run-btn" id="autoRunBtn"${autoRunStatus?.status === 'running' ? ' disabled' : ''}>${autoRunStatus?.status === 'running' ? '正在后台连续填写' : '后台连续填写到最终审核'}</button>
    </div>
  `;
  bindModeTabs();
  document.getElementById('scanBtn')!.addEventListener('click', startScan);
  document.getElementById('autoRunBtn')!.addEventListener('click', startAutoRun);
  document.getElementById('resumeAutoRunBtn')?.addEventListener('click', startAutoRun);
  document.getElementById('reviewMaterialsBtn')?.addEventListener('click', startScan);
  document.getElementById('stopAutoRunBtn')?.addEventListener('click', stopAutoRun);
  document.getElementById('stopTaskAgentBtn')?.addEventListener('click', stopAutoRun);
  document.getElementById('retryAgentBtn')?.addEventListener('click', () => controlPageAgent('retry_failed'));
  document.getElementById('replanAgentBtn')?.addEventListener('click', () => controlPageAgent('replan_page'));
  document.getElementById('locateAgentIssueBtn')?.addEventListener('click', async () => {
    const task = applicationTasks.find((item) => item.id === currentTaskId);
    const checkpoint = task?.runner?.agent;
    const result = checkpoint?.results.find((item) => (
      item.targetId && (item.status === 'failed' || item.status === 'review')
    ));
    if (!checkpoint || !result?.targetId) return;
    await sendRuntimeMessage({
      type: 'focusAgentTarget',
      payload: { pageKey: checkpoint.pageKey, targetId: result.targetId },
    });
  });
  document.getElementById('openAuditCenterBtn')?.addEventListener('click', async () => {
    const response = await sendRuntimeMessage<{ ok: boolean } | ErrorResponse>({ type: 'openAuditCenter' });
    if (response.ok) window.close();
  });
}

async function controlPageAgent(command: 'retry_failed' | 'replan_page'): Promise<void> {
  const response = await sendRuntimeMessage<AutoRunResponse | ErrorResponse>({
    type: 'controlPageAgent',
    payload: { command },
  });
  if (!response.ok) return;
  autoRunStatus = response;
  await refreshApplicationTasks();
  renderIdle(apiAvailable);
}

async function startAutoRun() {
  try {
    const response = await sendRuntimeMessage<AutoRunResponse | ErrorResponse>({ type: 'startAutoRun' });
    if (!response.ok) throw new Error(response.error);
    autoRunStatus = response as AutoRunResponse;
    await refreshApplicationTasks();
    renderIdle(apiAvailable);
  } catch {
    showError('无法启动后台连续填写，请刷新页面后重试');
  }
}

async function stopAutoRun() {
  try {
    const response = await sendRuntimeMessage<AutoRunResponse | ErrorResponse>({ type: 'stopAutoRun' });
    if (response.ok) {
      autoRunStatus = response as AutoRunResponse;
      await refreshApplicationTasks();
    }
    renderIdle(apiAvailable);
  } catch {
    showError('无法停止连续填写，请刷新页面后重试');
  }
}

function renderManualFill() {
  viewState = 'idle';
  removeFooter();
  const main = getMainContainer(false);
  const sectionsHtml = PROFILE_SECTIONS.map((section, index) => {
    const values = profileValues.filter((value) => value.sectionId === section.id);
    if (values.length === 0) return '';
    return `
      <details class="manual-section" ${index < 2 ? 'open' : ''}>
        <summary><span>${section.icon} ${section.title}</span><b>${values.length}</b></summary>
        <div class="manual-value-list">
          ${values.map((value) => `
            <button class="manual-value-btn" data-value="${escapeAttr(value.value)}">
              <span>${escapeHtml(value.key)}</span>
              <strong>${escapeHtml(value.value)}</strong>
            </button>
          `).join('')}
        </div>
      </details>
    `;
  }).join('');

  const customValues = profileValues.filter((value) => value.sectionId === 'custom');
  main.innerHTML = `
    ${renderModeTabs('manual')}
    <div class="manual-hint">先在报名网页中点击一个输入框，再点下方资料即可写入；验证码、文件、志愿和导师字段会被拦截。</div>
    <div id="manualStatus" class="manual-status"></div>
    <div class="manual-sections">
      ${sectionsHtml}
      ${customValues.length ? `
        <details class="manual-section">
          <summary><span>🗂 其他资料</span><b>${customValues.length}</b></summary>
          <div class="manual-value-list">
            ${customValues.map((value) => `<button class="manual-value-btn" data-value="${escapeAttr(value.value)}"><span>${escapeHtml(value.key)}</span><strong>${escapeHtml(value.value)}</strong></button>`).join('')}
          </div>
        </details>
      ` : ''}
    </div>
  `;
  bindModeTabs();
  main.querySelectorAll<HTMLButtonElement>('.manual-value-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const status = document.getElementById('manualStatus');
      try {
        const response = await sendRuntimeMessage<FillResponse | ErrorResponse>({
          type: 'manualFill',
          payload: { value: button.dataset.value ?? '' },
        });
        const success = response.ok && response.type === 'fill' && response.success === 1;
        if (status) {
          status.textContent = success ? '已写入当前输入框，可继续选择下一项。' : '未找到可填写的输入框，或该字段需要本人处理。';
          status.className = `manual-status show ${success ? 'success' : 'error'}`;
        }
      } catch {
        if (status) {
          status.textContent = '无法连接当前页面，请刷新后重试。';
          status.className = 'manual-status show error';
        }
      }
    });
  });
}

function renderScanning() {
  viewState = 'scanning';
  removeFooter();
  const main = getMainContainer(false);
  main.innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <div class="loading-text">正在识别表单字段...</div>
    </div>
  `;
}

function buildDisplayItems(scanResp: ScanResponse): DisplayItem[] {
  const matchedSet = new Map<number, MatchResult>();
  for (const m of scanResp.matches) {
    matchedSet.set(m.index, m);
  }

  const fieldByIndex = new Map(scanResp.fields.map((f) => [f.index, f]));
  const restoredCheckedIndexes = scanResp.checkedIndexes == null
    ? null
    : new Set(scanResp.checkedIndexes);
  const items: DisplayItem[] = [];

  for (const m of scanResp.matches) {
    const field = fieldByIndex.get(m.index);
    const fillMode = m.fillMode ?? field?.fillMode;
    const isLong = fillMode === 'long';
    const isFile = m.kind === 'file';
    const pageFilled = isMeaningfullyFilled(field ?? ({} as FormFieldInfo));
    const allowSystemPrefix = field?.selectionMode === 'dialog' || /出生地|籍贯|学校|院校|专业/.test(field?.label ?? '');
    const verified = !isFile && pageFilled && isPageValueConsistent(field?.value, m.value, allowSystemPrefix);
    const auditValue = pageFilled
      ? (isFile
          ? String(field?.value ?? m.value)
          : verified
          ? String(field?.value ?? '')
          : `页面：${String(field?.value ?? '')} / 资料：${m.value}`)
      : m.value;
    items.push({
      kind: m.kind ?? 'text',
      index: m.index,
      label: shortenLabel(m.shortLabel || m.fieldKey || `字段 #${m.index}`),
      value: auditValue,
      status: pageFilled
        ? (isFile ? 'filled' : (verified ? 'verified' : 'conflict'))
        : (isFile ? 'pending' : (isLong ? 'matched' : (m.confidence === 'high' ? 'matched' : 'pending'))),
      confidence: isLong ? undefined : m.confidence,
      fillMode,
      checked: pageFilled
        ? false
        : restoredCheckedIndexes
          ? restoredCheckedIndexes.has(m.index)
          : (isFile ? false : (isLong ? true : (m.confidence !== 'low'))),
      match: m,
    });
  }

  for (const f of scanResp.fields) {
    if (!matchedSet.has(f.index)) {
      const filled = !f.protected && isMeaningfullyFilled(f);
      items.push({
        kind: f.kind ?? 'text',
        index: f.index,
        label: getFieldLabel(f, f.index),
        value: f.protected ? (f.protectionReason || '需本人处理') : (filled ? String(f.value ?? '') : '-'),
        status: f.protected ? 'protected' : (filled ? 'filled' : 'unmatched'),
        checked: false,
      });
    }
  }

  return items;
}

function normalizeConfidence(value: unknown): Confidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function shortenLabel(label: string): string {
  const compact = label.replace(/\s+/g, '').replace(/[：:，,。；;|｜]/g, ' ');
  return compact.length > 12 ? `${compact.slice(0, 12)}…` : compact;
}

function getFieldLabel(field: FormFieldInfo | undefined, index: number): string {
  if (!field) return `字段 #${index}`;
  return shortenLabel(field.label || field.placeholder || field.ariaLabel || field.name || field.id || `字段 #${index}`);
}

function markerForItem(item: DisplayItem): { index: number; fingerprint?: string; status: 'verified' | 'review' | 'mismatch'; message: string } | null {
  const field = fields.find((candidate) => candidate.index === item.index);
  const fingerprint = field ? fieldFingerprint(field) : undefined;
  if (item.status === 'conflict') {
    return { index: item.index, fingerprint, status: 'mismatch', message: '保填：页面值与已保存资料不一致' };
  }
  if (item.status === 'verified') {
    return { index: item.index, fingerprint, status: 'verified', message: '保填：页面值与已保存资料一致' };
  }
  if (item.status === 'matched' && item.confidence === 'high') {
    return { index: item.index, fingerprint, status: 'verified', message: '保填：高置信匹配，待确认填入' };
  }
  if (item.status === 'pending') {
    return { index: item.index, fingerprint, status: 'review', message: '保填：匹配结果需要确认' };
  }
  if (item.status === 'filled') {
    return { index: item.index, fingerprint, status: 'review', message: '保填：页面已有值，但资料中没有可核对项' };
  }
  if (item.status === 'protected') {
    return { index: item.index, fingerprint, status: 'review', message: '保填：该字段需本人处理' };
  }
  return null;
}

function getDisplayMarkers(): Array<{ index: number; fingerprint?: string; status: 'verified' | 'review' | 'mismatch'; message: string }> {
  return displayItems.flatMap((item) => {
    const marker = markerForItem(item);
    return marker ? [marker] : [];
  });
}

function persistCurrentPageAnalysis(): void {
  if (!currentScan) return;
  void sendRuntimeMessage({
    type: 'savePageAnalysis',
    payload: {
      scan: currentScan,
      markers: getDisplayMarkers(),
      checkedIndexes: displayItems.filter((item) => item.checked).map((item) => item.index),
      repeatPlan: currentScan.repeatPlan,
    },
  }).catch(() => undefined);
}

function syncPageMarkers(): void {
  const items = getDisplayMarkers();
  void sendRuntimeMessage({ type: 'markPageFields', payload: { items } }).catch(() => undefined);
  persistCurrentPageAnalysis();
}

function locatePageField(index: number): void {
  void sendRuntimeMessage({ type: 'focusPageField', payload: { index } }).catch(() => undefined);
}

function refreshMaterialRow(index: number): void {
  const item = displayItems.find((candidate) => candidate.index === index);
  const fileRecordId = item?.match?.fileRecordId;
  if (!item || fileRecordId == null) return;
  const reviewed = previewedMaterialByField.get(index) === fileRecordId;
  const row = document.querySelector<HTMLElement>(`.field-item[data-index="${index}"]`);
  row?.classList.toggle('material-previewed', reviewed);
  const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox && (item.status === 'matched' || item.status === 'pending')) {
    checkbox.disabled = !reviewed;
    if (!reviewed) {
      checkbox.checked = false;
      item.checked = false;
    }
  }
  const status = row?.querySelector<HTMLElement>('.field-status');
  if (status && reviewed) status.innerHTML = '<span class="status-tag verified">已预览</span>';
  updateFooterButton();
}

function previewMaterial(
  fieldIndex: number,
  fileRecordId: number,
  queue: Array<{ index: number; fileRecordId: number }> = [{ index: fieldIndex, fileRecordId }],
): void {
  const record = materialFileRecords.find((file) => file.id === fileRecordId);
  if (!record) {
    showError('候选材料已不存在，请回到工作台重新添加');
    return;
  }

  document.querySelector('.material-preview-overlay')?.remove();
  const objectUrl = URL.createObjectURL(record.fileBody);
  const fileType = (record.fileType || '').toLowerCase();
  const isImage = fileType.startsWith('image/') || /\.(?:png|jpe?g|gif|webp)$/i.test(record.filename);
  const isPdf = fileType === 'application/pdf' || /\.pdf$/i.test(record.filename);
  const field = fields.find((candidate) => candidate.index === fieldIndex);
  const questionTitle = materialFieldDisplayLabel(field ?? {}, currentScan?.pageLabel || '', fieldIndex);
  const position = Math.max(0, queue.findIndex((item) => item.index === fieldIndex && item.fileRecordId === fileRecordId));
  const overlay = document.createElement('div');
  overlay.className = 'material-preview-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const previewBody = isImage
    ? `<img class="material-preview-image" src="${escapeAttr(objectUrl)}" alt="${escapeAttr(record.filename)}" />`
    : isPdf
      ? `<iframe class="material-preview-frame" src="${escapeAttr(objectUrl)}#toolbar=0" title="${escapeAttr(record.filename)}"></iframe>`
      : `<div class="material-preview-unsupported"><strong>${escapeHtml(record.filename)}</strong><span>此格式无法在小窗内直接显示，请确认文件名和类型，或到材料库查看原文件。</span></div>`;
  overlay.innerHTML = `
    <div class="material-preview-dialog">
      <div class="material-preview-head">
        <div><strong>预览材料</strong><span>${queue.length > 1 ? `${position + 1} / ${queue.length}` : '上传前核对'}</span></div>
        <button type="button" class="material-preview-close" aria-label="关闭预览">&times;</button>
      </div>
      <div class="material-preview-question"><span>当前上传项</span><strong>${escapeHtml(questionTitle)}</strong></div>
      <div class="material-preview-name" title="${escapeAttr(record.filename)}"><span>候选文件</span>${escapeHtml(record.filename)}</div>
      <div class="material-preview-body">${previewBody}</div>
      <div class="material-preview-actions">
        <button type="button" class="secondary-btn material-preview-cancel">稍后检查</button>
        <button type="button" class="fill-btn material-preview-confirm">${position < queue.length - 1 ? '已检查，下一份' : '已检查此材料'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => {
    URL.revokeObjectURL(objectUrl);
    overlay.remove();
  };
  overlay.querySelector('.material-preview-close')?.addEventListener('click', close);
  overlay.querySelector('.material-preview-cancel')?.addEventListener('click', close);
  overlay.querySelector('.material-preview-confirm')?.addEventListener('click', () => {
    previewedMaterialByField.set(fieldIndex, fileRecordId);
    refreshMaterialRow(fieldIndex);
    close();
    const next = queue[position + 1];
    if (next) previewMaterial(next.index, next.fileRecordId, queue);
  });
}

async function previewExistingMaterial(fieldIndex: number): Promise<void> {
  try {
    const response = await sendRuntimeMessage<ExistingMaterialPreviewResponse | ErrorResponse>({
      type: 'previewExistingMaterial',
      payload: { index: fieldIndex },
    });
    if (!response.ok) throw new Error(response.error);

    document.querySelector('.material-preview-overlay')?.remove();
    const field = fields.find((candidate) => candidate.index === fieldIndex);
    const questionTitle = materialFieldDisplayLabel(field ?? {}, currentScan?.pageLabel || '', fieldIndex);
    const previewBody = response.dataUrl
      ? `<img class="material-preview-image" src="${escapeAttr(response.dataUrl)}" alt="${escapeAttr(questionTitle)}" />`
      : `<div class="material-preview-unsupported"><strong>网页已有材料</strong><span>该网站没有提供可读取的小窗预览，请同时查看报名网页中的现有文件或缩略图后再确认。</span></div>`;
    const overlay = document.createElement('div');
    overlay.className = 'material-preview-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="material-preview-dialog">
        <div class="material-preview-head">
          <div><strong>预览网页现有材料</strong><span>继续前核对</span></div>
          <button type="button" class="material-preview-close" aria-label="关闭预览">&times;</button>
        </div>
        <div class="material-preview-question"><span>当前上传项</span><strong>${escapeHtml(questionTitle)}</strong></div>
        <div class="material-preview-name"><span>网页状态</span>${escapeHtml(response.evidence || '网页已有材料')}</div>
        <div class="material-preview-body">${previewBody}</div>
        <div class="material-preview-actions">
          <button type="button" class="secondary-btn material-preview-cancel">稍后检查</button>
          <button type="button" class="fill-btn material-preview-confirm">已检查此材料</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.material-preview-close')?.addEventListener('click', close);
    overlay.querySelector('.material-preview-cancel')?.addEventListener('click', close);
    overlay.querySelector('.material-preview-confirm')?.addEventListener('click', () => {
      previewedExistingMaterialFields.add(fieldIndex);
      const row = document.querySelector<HTMLElement>(`.field-item[data-index="${fieldIndex}"]`);
      row?.classList.add('material-previewed');
      const status = row?.querySelector<HTMLElement>('.field-status');
      if (status) status.innerHTML = '<span class="status-tag verified">已预览</span>';
      close();
      updateFooterButton();
    });
  } catch (error) {
    showError(error instanceof Error ? error.message : '无法读取网页现有材料预览');
  }
}

function renderResult(scanResp: ScanResponse) {
  viewState = 'result';
  if (currentScan?.pageSignature !== scanResp.pageSignature) {
    previewedMaterialByField.clear();
    previewedExistingMaterialFields.clear();
  }
  currentScan = scanResp;
  fields = scanResp.fields;
  displayItems = buildDisplayItems(scanResp);

  const verifiedCount = displayItems.filter((i) => i.status === 'verified').length;
  const reviewCount = displayItems.filter((i) => i.status === 'conflict' || i.status === 'filled' || i.status === 'protected').length;
  const matchedCount = displayItems.filter((i) => i.status === 'matched' || i.status === 'pending').length;
  const checkedCount = displayItems.filter((i) => i.checked && (i.status === 'matched' || i.status === 'pending')).length;
  const materialItems = displayItems.filter((item) => item.kind === 'file');
  const materialCandidates = materialItems.filter((item) => item.match?.fileRecordId != null);
  const uploadedMaterialCount = materialItems.filter((item) => {
    const field = scanResp.fields.find((candidate) => candidate.index === item.index);
    return field ? isMeaningfullyFilled(field) : false;
  }).length;
  const requiredMaterialMissing = scanResp.fields.filter((field) => (
    field.kind === 'file' && field.required && !isMeaningfullyFilled(field)
  )).length;

  const main = getMainContainer(true);

  if (scanResp.total === 0) {
    main.innerHTML = `
      <div class="result-msg">
        <div class="icon empty">📭</div>
        <div class="text">未检测到表单字段</div>
        <div class="sub">当前页面无可填充的输入框</div>
      </div>
    `;
    renderFooter(0);
    return;
  }

  main.innerHTML = `
    ${materialItems.length > 0 ? `
      <div class="material-review-card">
        <div class="material-review-title"><strong>材料上传核对</strong><span>${uploadedMaterialCount}/${materialItems.length} 已写入</span></div>
        <p>保填会保留网页已有材料，并为新材料按页面题目选择候选。进入下一步前，请逐项核对“上传项名称”和实际文件；低置信候选不会自动上传。</p>
        <div class="material-review-meta">
          <span>${materialCandidates.length} 组候选</span>
          <span>${requiredMaterialMissing > 0 ? `${requiredMaterialMissing} 个必填项待补齐` : '必填项已齐'}</span>
        </div>
        ${materialCandidates.length > 0 ? '<button type="button" class="material-review-all" id="previewAllMaterialsBtn">预览全部已选材料</button>' : ''}
      </div>
    ` : ''}
    <div class="ai-scan-status ${scanResp.ai.error ? 'error' : scanResp.ai.attempted ? 'success' : 'idle'}">
      ${scanResp.ai.error
        ? `AI 调用失败：${escapeHtml(scanResp.ai.error)}`
        : scanResp.ai.attempted
          ? `AI 已真实调用 · ${scanResp.ai.mode === 'enhanced' ? '增强复核' : '补漏'} · 返回 ${scanResp.ai.reviewed} 项`
          : scanResp.ai.configured
            ? 'AI 已配置，本页没有需要发送的安全字段'
            : 'AI 未配置，本次仅使用本地规则'}
    </div>
    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-value">${scanResp.total}</div>
        <div class="stat-label">识别字段</div>
      </div>
      <div class="stat-item">
        <div class="stat-value matched">${matchedCount}</div>
        <div class="stat-label">待填匹配</div>
      </div>
      <div class="stat-item">
        <div class="stat-value filled">${verifiedCount}</div>
        <div class="stat-label">核对一致</div>
      </div>
      <div class="stat-item">
        <div class="stat-value protected">${reviewCount}</div>
        <div class="stat-label">需检查</div>
      </div>
    </div>
    <div class="fill-policy" role="group" aria-label="填充策略"${materialItems.length === displayItems.length ? ' hidden' : ''}>
      <button data-policy="cautious">保守</button>
      <button data-policy="standard" class="active">标准</button>
      <button data-policy="aggressive">尽量填充</button>
    </div>
    <div class="field-list-card">
      <div class="field-list-header">
        <span class="col-label">字段</span>
        <span class="col-value">匹配内容</span>
        <span class="col-status">状态</span>
      </div>
      <ul class="field-list" id="fieldList"></ul>
    </div>
  `;

  const list = document.getElementById('fieldList')!;
  for (const item of displayItems) {
    const li = document.createElement('li');
    li.className = `field-item ${item.kind === 'file' ? 'file-item' : ''} ${item.fillMode === 'long' ? 'long-text-item' : ''} ${item.confidence ? `confidence-${item.confidence}` : ''}`.trim();
    li.dataset.index = String(item.index);
    li.title = '点击定位网页字段';

    const selectedFileId = item.match?.fileRecordId;
    const itemField = scanResp.fields.find((candidate) => candidate.index === item.index);
    const existingWebsiteMaterial = item.kind === 'file'
      && selectedFileId == null
      && Boolean(itemField && isMeaningfullyFilled(itemField));
    const materialPreviewed = item.kind !== 'file' || (selectedFileId != null && previewedMaterialByField.get(item.index) === selectedFileId);
    const checkboxHtml = item.status === 'matched' || item.status === 'pending'
      ? `<input type="checkbox" data-idx="${item.index}" ${item.checked ? 'checked' : ''} ${materialPreviewed ? '' : 'disabled'} />`
      : `<input type="checkbox" data-idx="${item.index}" disabled />`;

    const statusHtml = existingWebsiteMaterial && previewedExistingMaterialFields.has(item.index)
      ? '<span class="status-tag verified">已预览</span>'
      : getStatusHtml(item);
    const candidates = item.match?.fileCandidates ?? [];
    const valueHtml = item.kind === 'file'
      ? `<span class="field-value material-match-value">
          ${candidates.length > 1
            ? `<select class="material-candidate-select" data-idx="${item.index}" aria-label="选择候选材料">
                ${candidates.map((candidate) => `<option value="${candidate.fileRecordId}"${candidate.fileRecordId === item.match?.fileRecordId ? ' selected' : ''}>${escapeHtml(candidate.fileName)}</option>`).join('')}
              </select>`
            : `<span title="${escapeAttr(item.value)}">${escapeHtml(item.value)}</span>`}
          ${item.match?.fileRecordId != null ? `<button type="button" class="material-preview-btn" data-index="${item.index}" data-file-id="${item.match.fileRecordId}">预览材料</button>` : ''}
          ${existingWebsiteMaterial ? `<button type="button" class="material-preview-btn material-existing-preview-btn" data-index="${item.index}">预览网页现有材料</button>` : ''}
        </span>`
      : `<span class="field-value" title="${escapeAttr(item.value)}">${escapeHtml(item.value)}</span>`;

    li.innerHTML = `
      ${checkboxHtml}
      <span class="field-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
      ${valueHtml}
      <span class="field-status">${statusHtml}</span>
    `;
    li.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('input[type="checkbox"]')) return;
      locatePageField(item.index);
    });
    list.appendChild(li);
  }

  list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.dataset.idx);
      const item = displayItems.find((i) => i.index === idx);
      if (item) item.checked = cb.checked;
      updateFooterButton();
      persistCurrentPageAnalysis();
    });
  });

  list.querySelectorAll<HTMLSelectElement>('.material-candidate-select').forEach((select) => {
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
      const item = displayItems.find((candidate) => candidate.index === Number(select.dataset.idx));
      const candidate = item?.match?.fileCandidates?.find((file) => file.fileRecordId === Number(select.value));
      if (!item?.match || !candidate) return;
      item.value = candidate.fileName;
      item.match.value = candidate.fileName;
      item.match.fileRecordId = candidate.fileRecordId;
      item.match.fileName = candidate.fileName;
      item.match.fileType = candidate.fileType;
      previewedMaterialByField.delete(item.index);
      item.checked = false;
      const preview = select.closest('.material-match-value')?.querySelector<HTMLButtonElement>('.material-preview-btn');
      if (preview) preview.dataset.fileId = String(candidate.fileRecordId);
      refreshMaterialRow(item.index);
      persistCurrentPageAnalysis();
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.material-preview-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (button.classList.contains('material-existing-preview-btn')) return;
      previewMaterial(Number(button.dataset.index), Number(button.dataset.fileId));
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.material-existing-preview-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void previewExistingMaterial(Number(button.dataset.index));
    });
  });

  document.getElementById('previewAllMaterialsBtn')?.addEventListener('click', () => {
    const queue = displayItems.flatMap((item) => (
      item.kind === 'file' && item.match?.fileRecordId != null
        ? [{ index: item.index, fileRecordId: item.match.fileRecordId }]
        : []
    ));
    const first = queue[0];
    if (first) previewMaterial(first.index, first.fileRecordId, queue);
  });

  main.querySelectorAll<HTMLButtonElement>('.fill-policy button').forEach((button) => {
    button.addEventListener('click', () => applyFillPolicy(button.dataset.policy ?? 'standard'));
  });

  syncPageMarkers();
  renderFooter(checkedCount);
  updateFooterButton();
}

function getStatusHtml(item: DisplayItem): string {
  if (item.status === 'protected') {
    return '<span class="status-tag protected">人工</span>';
  }
  if (item.status === 'unmatched') {
    return '<span class="status-tag unmatched">未匹配</span>';
  }
  if (item.status === 'filled') {
    return item.kind === 'file'
      ? '<span class="status-tag filled">已上传</span>'
      : '<span class="status-tag filled">无法核对</span>';
  }
  if (item.status === 'verified') {
    return `<span class="status-tag verified">${item.match?.source === 'ai_reviewed' || item.match?.source === 'ai' ? 'AI一致' : '一致'}</span>`;
  }
  if (item.status === 'conflict') {
    return `<span class="status-tag conflict">${item.match?.source === 'ai_reviewed' || item.match?.source === 'ai' ? 'AI不一致' : '不一致'}</span>`;
  }

  if (item.kind === 'file') {
    return '<span class="status-tag pending">确认文件</span>';
  }

  if (item.fillMode === 'long') {
    return '<span class="status-tag long-text">长文本</span>';
  }

  const confidence = item.confidence ?? 'medium';
  const labelMap: Record<Confidence, string> = {
    high: '高',
    medium: '中',
    low: '低',
  };
  const sourceLabel = item.match?.source === 'ai' ? 'AI' : item.match?.source === 'ai_reviewed' ? 'AI复核' : '本地';
  return `<span class="status-tag ${confidence}">${sourceLabel}${labelMap[confidence]}</span>`;
}

function applyFillPolicy(policy: string): void {
  document.querySelectorAll('.fill-policy button').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.policy === policy);
  });
  displayItems.forEach((item) => {
    if (item.status !== 'matched' && item.status !== 'pending') return;
    if (item.kind === 'file') {
      item.checked = false;
      return;
    }
    item.checked = policy === 'aggressive'
      ? true
      : policy === 'cautious'
        ? item.confidence === 'high' || item.fillMode === 'long'
        : item.confidence !== 'low' || item.fillMode === 'long';
    const checkbox = document.querySelector<HTMLInputElement>(`input[type="checkbox"][data-idx="${item.index}"]`);
    if (checkbox) checkbox.checked = item.checked;
  });
  updateFooterButton();
  persistCurrentPageAnalysis();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function removeFooter() {
  const footer = app.querySelector<HTMLElement>('.footer');
  if (footer) footer.remove();
}

function renderFooter(matchedCount: number) {
  removeFooter();
  const footer = document.createElement('div');
  footer.className = 'footer';
  footer.innerHTML = `
    <button class="fill-btn" id="fillBtn">一键自动填充（${matchedCount} 项）</button>
    <button class="secondary-btn" id="rescanBtn">重新扫描</button>
  `;
  app.appendChild(footer);

  const fillBtn = document.getElementById('fillBtn') as HTMLButtonElement;
  fillBtn.disabled = matchedCount === 0;
  fillBtn.addEventListener('click', handlePrimaryAction);

  document.getElementById('rescanBtn')!.addEventListener('click', startScan);
}

function getMaterialReviewState(): {
  materialMode: boolean;
  missingRequired: number;
  unpreviewed: number;
  canConfirm: boolean;
} {
  const items = fields
    .filter((field) => field.kind === 'file')
    .map((field) => ({
      index: field.index,
      required: Boolean(field.required),
      filled: isMeaningfullyFilled(field),
      fileRecordId: displayItems.find((item) => item.index === field.index)?.match?.fileRecordId,
    }));
  return computeMaterialReviewState(
    items,
    previewedMaterialByField,
    previewedExistingMaterialFields,
    isMaterialReviewPause(autoRunStatus),
  );
}

async function confirmMaterialsAndResume(): Promise<void> {
  try {
    const response = await sendRuntimeMessage<AutoRunResponse | ErrorResponse>({ type: 'confirmMaterialsAndResume' });
    if (!response.ok) throw new Error(response.error);
    autoRunStatus = response as AutoRunResponse;
    await refreshApplicationTasks();
    renderIdle(apiAvailable);
  } catch (error) {
    showError(error instanceof Error ? error.message : '无法确认材料，请刷新页面后重试');
  }
}

function handlePrimaryAction(): void {
  const selected = displayItems.filter((item) => item.checked && (item.status === 'matched' || item.status === 'pending'));
  if (selected.length > 0) {
    startFill();
    return;
  }
  if (getMaterialReviewState().canConfirm) void confirmMaterialsAndResume();
}

function updateFooterButton() {
  const selected = displayItems.filter((i) => i.checked && (i.status === 'matched' || i.status === 'pending'));
  const checkedCount = selected.length;
  const selectedFiles = selected.filter((item) => item.kind === 'file').length;
  const materialReview = getMaterialReviewState();
  const fillBtn = document.getElementById('fillBtn') as HTMLButtonElement | null;
  if (fillBtn) {
    if (checkedCount > 0) {
      fillBtn.textContent = selectedFiles > 0
        ? `确认上传（${selectedFiles} 项）`
        : `一键自动填充（${checkedCount} 项）`;
      fillBtn.disabled = false;
    } else if (materialReview.materialMode) {
      if (materialReview.missingRequired > 0) {
        fillBtn.textContent = `还有 ${materialReview.missingRequired} 个必填材料未上传`;
        fillBtn.disabled = true;
      } else if (materialReview.unpreviewed > 0) {
        fillBtn.textContent = `还需预览 ${materialReview.unpreviewed} 项材料`;
        fillBtn.disabled = true;
      } else if (materialReview.canConfirm) {
        fillBtn.textContent = '确认材料并继续下一步';
        fillBtn.disabled = false;
      } else {
        fillBtn.textContent = '材料已核对';
        fillBtn.disabled = true;
      }
    } else {
      fillBtn.textContent = '一键自动填充（0 项）';
      fillBtn.disabled = true;
    }
  }
}

function startScan() {
  renderScanning();

  chrome.runtime.sendMessage({ type: 'startScan' }, (response: ScanResponse | ErrorResponse) => {
    if (chrome.runtime.lastError) {
      showError('无法连接到页面，请刷新后重试');
      return;
    }
    if (!response?.ok) {
      showError((response as ErrorResponse).error);
      return;
    }
    const scanResp = response as ScanResponse;
    renderResult(scanResp);
  });
}

function showError(message: string) {
  viewState = 'idle';
  removeFooter();
  const main = getMainContainer(false);
  main.innerHTML = `
    <div class="result-msg">
      <div class="icon error">✕</div>
      <div class="text">扫描失败</div>
      <div class="sub">${escapeHtml(message)}</div>
    </div>
  `;

  const btn = document.createElement('button');
  btn.className = 'scan-btn';
  btn.style.marginTop = '20px';
  btn.style.maxWidth = '200px';
  btn.textContent = '重新扫描';
  btn.addEventListener('click', startScan);
  main.querySelector('.result-msg')!.appendChild(btn);
}

function startFill() {
  const selected = displayItems
    .filter((i) => i.checked && i.status !== 'unmatched')
    .map((i) => i.match)
    .filter((match): match is MatchResult => Boolean(match));

  if (selected.length === 0) return;
  lastFillIncludedFiles = selected.some((match) => match.kind === 'file');

  viewState = 'filling';
  removeFooter();
  const main = getMainContainer(false);
  main.innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <div class="loading-text">正在填充表单...</div>
    </div>
  `;

  chrome.runtime.sendMessage(
    { type: 'startFill', payload: { matches: selected } },
    (response: FillResponse | ErrorResponse) => {
      if (chrome.runtime.lastError) {
        renderFillResult(false, 0, 0, chrome.runtime.lastError.message);
        return;
      }
      if (!response?.ok) {
        renderFillResult(false, 0, 0, (response as ErrorResponse).error);
        return;
      }
      const fillResp = response as FillResponse;
      renderFillResult(fillResp.failure === 0, fillResp.success, fillResp.failure);
    },
  );
}

function renderFillResult(success: boolean, successCount: number, failureCount: number, errorMsg?: string) {
  viewState = 'filled';
  removeFooter();
  const main = getMainContainer(false);

  if (!success && errorMsg) {
    main.innerHTML = `
      <div class="result-msg">
        <div class="icon error">✕</div>
        <div class="text">填充失败</div>
        <div class="sub">${escapeHtml(errorMsg)}</div>
      </div>
    `;
  } else if (failureCount === 0) {
    main.innerHTML = `
      <div class="result-msg">
        <div class="icon success">✓</div>
        <div class="text">${lastFillIncludedFiles ? '材料已写入页面' : '填充完成'}</div>
        <div class="sub">${lastFillIncludedFiles ? `成功写入 ${successCount} 份材料，请核对网页上传结果` : `成功填充 ${successCount} 个字段`}</div>
      </div>
    `;
  } else {
    main.innerHTML = `
      <div class="result-msg">
        <div class="icon success">✓</div>
        <div class="text">填充完成</div>
        <div class="sub">成功 ${successCount} 个，失败 ${failureCount} 个</div>
      </div>
    `;
  }

  const btn = document.createElement('button');
  btn.className = 'scan-btn';
  btn.style.marginTop = '20px';
  btn.style.maxWidth = '200px';
  btn.textContent = lastFillIncludedFiles ? '核对上传结果' : '关闭';
  btn.addEventListener('click', lastFillIncludedFiles ? startScan : () => window.close());
  main.querySelector('.result-msg')!.appendChild(btn);
}

init().catch((err) => {
  renderHeader();
  showError(err instanceof Error ? err.message : '插件初始化失败');
});
