import './style.css';
import { isApiConfigured } from '@/utils/storage';
import { getAllBlockCategories, getAllFileRecords, getAllTextFields } from '@/utils/db';
import type { MatchResult, FormFieldInfo } from '@/utils/matcher';
import { flattenProfileValues, PROFILE_SECTIONS } from '@/utils/profile-schema';
import type { ProfileSourceValue } from '@/utils/profile-schema';
import { isMeaningfullyFilled } from '@/utils/local-matcher';
import { isPageValueConsistent } from '@/utils/value-compare';

const app = document.getElementById('app')!;

interface ScanResponse {
  ok: true;
  type: 'scan';
  total: number;
  matched: number;
  matches: MatchResult[];
  fields: FormFieldInfo[];
  ai: {
    configured: boolean;
    mode: 'enhanced' | 'fallback';
    attempted: boolean;
    reviewed: number;
    error: string;
  };
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
  status: 'running' | 'paused' | 'complete' | 'stopped';
  pageCount: number;
  filledCount: number;
  message: string;
  updatedAt: number;
}

type ViewState = 'idle' | 'scanning' | 'result' | 'filling' | 'filled' | 'streaming';
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

  renderHeader();

  try {
    const [inspected, autoStatus] = await Promise.all([
      sendRuntimeMessage<InspectResponse | ErrorResponse>({ type: 'inspectPage' }),
      sendRuntimeMessage<AutoRunResponse | ErrorResponse>({ type: 'getAutoRunStatus' }),
    ]);
    pageStatus = inspected.ok ? inspected as InspectResponse : null;
    autoRunStatus = autoStatus.ok ? autoStatus as AutoRunResponse : null;
  } catch {
    pageStatus = null;
    autoRunStatus = null;
  }

  const hasMaterials = fileRecords.length > 0;
  if (profileValues.length === 0 && !hasMaterials) {
    renderNotConfigured(true);
    return;
  }

  renderIdle(apiReady);
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
      ${autoRunStatus.status === 'running'
        ? '<button id="stopAutoRunBtn" class="auto-run-link danger">停止</button>'
        : autoRunStatus.status === 'paused'
          ? '<button id="resumeAutoRunBtn" class="auto-run-link">处理后继续</button>'
          : ''}
    </div>
  ` : '';
  main.innerHTML = `
    ${renderModeTabs('smart')}
    ${statusHtml}
    ${autoHtml}
    <div class="scan-card">
      <div class="scan-icon-wrap">⚡</div>
      <div class="scan-title">快速填充当前页面</div>
      <div class="scan-desc">先预览匹配结果，再由你确认填入。${apiReady ? 'AI 可辅助处理低置信字段。' : '未配置 AI 时仍可使用本地明确匹配。'}</div>
      <button class="scan-btn" id="scanBtn">识别并预览</button>
      <button class="scan-btn auto-run-btn" id="autoRunBtn"${autoRunStatus?.status === 'running' ? ' disabled' : ''}>${autoRunStatus?.status === 'running' ? '正在后台连续填写' : '后台连续填写到最终审核'}</button>
      <div class="auto-run-note">可关闭弹窗或切换页面；遇到无法处理的必填项会暂停，绝不点击最终提交。</div>
      ${apiReady ? '<button class="scan-btn stream-btn" id="streamScanBtn">AI 流式快速填充</button>' : ''}
    </div>
  `;
  bindModeTabs();
  document.getElementById('scanBtn')!.addEventListener('click', startScan);
  document.getElementById('autoRunBtn')!.addEventListener('click', startAutoRun);
  document.getElementById('resumeAutoRunBtn')?.addEventListener('click', startAutoRun);
  document.getElementById('stopAutoRunBtn')?.addEventListener('click', stopAutoRun);
  document.getElementById('streamScanBtn')?.addEventListener('click', startStreamScan);
}

async function startAutoRun() {
  try {
    const response = await sendRuntimeMessage<AutoRunResponse | ErrorResponse>({ type: 'startAutoRun' });
    if (!response.ok) throw new Error(response.error);
    autoRunStatus = response as AutoRunResponse;
    renderIdle(apiAvailable);
  } catch {
    showError('无法启动后台连续填写，请刷新页面后重试');
  }
}

async function stopAutoRun() {
  try {
    const response = await sendRuntimeMessage<AutoRunResponse | ErrorResponse>({ type: 'stopAutoRun' });
    if (response.ok) autoRunStatus = response as AutoRunResponse;
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
  const items: DisplayItem[] = [];

  for (const m of scanResp.matches) {
    const field = fieldByIndex.get(m.index);
    const fillMode = m.fillMode ?? field?.fillMode;
    const isLong = fillMode === 'long';
    const isFile = m.kind === 'file';
    const pageFilled = !isFile && isMeaningfullyFilled(field ?? ({} as FormFieldInfo));
    const allowSystemPrefix = field?.selectionMode === 'dialog' || /出生地|籍贯|学校|院校|专业/.test(field?.label ?? '');
    const verified = pageFilled && isPageValueConsistent(field?.value, m.value, allowSystemPrefix);
    const auditValue = pageFilled
      ? (verified
          ? String(field?.value ?? '')
          : `页面：${String(field?.value ?? '')} / 资料：${m.value}`)
      : m.value;
    items.push({
      kind: m.kind ?? 'text',
      index: m.index,
      label: shortenLabel(m.shortLabel || m.fieldKey || `字段 #${m.index}`),
      value: auditValue,
      status: pageFilled
        ? (verified ? 'verified' : 'conflict')
        : (isFile ? 'pending' : (isLong ? 'matched' : (m.confidence === 'high' ? 'matched' : 'pending'))),
      confidence: isLong ? undefined : m.confidence,
      fillMode,
      checked: pageFilled ? false : (isFile ? false : (isLong ? true : (m.confidence !== 'low'))),
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

function markerForItem(item: DisplayItem): { index: number; status: 'verified' | 'review' | 'mismatch'; message: string } | null {
  if (item.status === 'conflict') {
    return { index: item.index, status: 'mismatch', message: '保填：页面值与已保存资料不一致' };
  }
  if (item.status === 'verified') {
    return { index: item.index, status: 'verified', message: '保填：页面值与已保存资料一致' };
  }
  if (item.status === 'matched' && item.confidence === 'high') {
    return { index: item.index, status: 'verified', message: '保填：高置信匹配，待确认填入' };
  }
  if (item.status === 'pending') {
    return { index: item.index, status: 'review', message: '保填：匹配结果需要确认' };
  }
  if (item.status === 'filled') {
    return { index: item.index, status: 'review', message: '保填：页面已有值，但资料中没有可核对项' };
  }
  if (item.status === 'protected') {
    return { index: item.index, status: 'review', message: '保填：该字段需本人处理' };
  }
  return null;
}

function syncPageMarkers(): void {
  const items = displayItems.flatMap((item) => {
    const marker = markerForItem(item);
    return marker ? [marker] : [];
  });
  void sendRuntimeMessage({ type: 'markPageFields', payload: { items } }).catch(() => undefined);
}

function locatePageField(index: number): void {
  void sendRuntimeMessage({ type: 'focusPageField', payload: { index } }).catch(() => undefined);
}

function renderResult(scanResp: ScanResponse) {
  viewState = 'result';
  fields = scanResp.fields;
  displayItems = buildDisplayItems(scanResp);

  const verifiedCount = displayItems.filter((i) => i.status === 'verified').length;
  const reviewCount = displayItems.filter((i) => i.status === 'conflict' || i.status === 'filled' || i.status === 'protected').length;
  const matchedCount = displayItems.filter((i) => i.status === 'matched' || i.status === 'pending').length;
  const checkedCount = displayItems.filter((i) => i.checked && (i.status === 'matched' || i.status === 'pending')).length;

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
    <div class="fill-policy" role="group" aria-label="填充策略">
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

    const checkboxHtml = item.status === 'matched' || item.status === 'pending'
      ? `<input type="checkbox" data-idx="${item.index}" ${item.checked ? 'checked' : ''} />`
      : `<input type="checkbox" data-idx="${item.index}" disabled />`;

    const statusHtml = getStatusHtml(item);

    li.innerHTML = `
      ${checkboxHtml}
      <span class="field-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
      <span class="field-value" title="${escapeHtml(item.value)}">${escapeHtml(item.value)}</span>
      <span class="field-status">${statusHtml}</span>
    `;
    li.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('input[type="checkbox"]')) return;
      locatePageField(item.index);
    });
    list.appendChild(li);
  }

  list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not([disabled])').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.dataset.idx);
      const item = displayItems.find((i) => i.index === idx);
      if (item) item.checked = cb.checked;
      updateFooterButton();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('.fill-policy button').forEach((button) => {
    button.addEventListener('click', () => applyFillPolicy(button.dataset.policy ?? 'standard'));
  });

  syncPageMarkers();
  renderFooter(checkedCount);
}

function getStatusHtml(item: DisplayItem): string {
  if (item.status === 'protected') {
    return '<span class="status-tag protected">人工</span>';
  }
  if (item.status === 'unmatched') {
    return '<span class="status-tag unmatched">未匹配</span>';
  }
  if (item.status === 'filled') {
    return '<span class="status-tag filled">无法核对</span>';
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
  fillBtn.addEventListener('click', startFill);

  document.getElementById('rescanBtn')!.addEventListener('click', startScan);
}

function updateFooterButton() {
  const checkedCount = displayItems.filter((i) => i.checked && (i.status === 'matched' || i.status === 'pending')).length;
  const fillBtn = document.getElementById('fillBtn') as HTMLButtonElement | null;
  if (fillBtn) {
    fillBtn.textContent = `一键自动填充（${checkedCount} 项）`;
    fillBtn.disabled = checkedCount === 0;
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
        <div class="text">填充完成</div>
        <div class="sub">成功填充 ${successCount} 个字段</div>
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
  btn.textContent = '关闭';
  btn.addEventListener('click', () => window.close());
  main.querySelector('.result-msg')!.appendChild(btn);
}

// ─── Streaming fill ─────────────────────────────────────────────────

function startStreamScan() {
  viewState = 'streaming';
  renderStreamProgress();

  const port = chrome.runtime.connect({ name: 'stream-fill' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'streamProgress') {
      updateStreamProgress(msg.matched, msg.total, msg.latestLabel);
    } else if (msg.type === 'streamComplete') {
      renderStreamComplete(msg.matched, msg.errorCount);
      port.disconnect();
    } else if (msg.type === 'streamError') {
      renderStreamError(msg.error);
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    if (viewState === 'streaming') {
      renderStreamError('连接已断开');
    }
  });

  port.postMessage({ type: 'startStreamScan' });
}

function renderStreamProgress() {
  removeFooter();
  const main = getMainContainer(false);
  main.innerHTML = `
    <div class="stream-progress">
      <div class="stream-header">
        <div class="stream-spinner"></div>
        <span class="stream-title">AI 正在识别并填充...</span>
      </div>
      <div class="stream-progress-bar-wrap">
        <div class="stream-progress-bar">
          <div class="stream-progress-fill" id="streamProgressFill" style="width:0%"></div>
        </div>
        <div class="stream-progress-text">
          <span id="streamMatchedCount">0</span> / <span id="streamTotalCount">--</span>
        </div>
      </div>
      <div class="stream-field-list" id="streamFieldList"></div>
    </div>
  `;
}

function updateStreamProgress(matched: number, total: number, latestLabel: string) {
  const fill = document.getElementById('streamProgressFill');
  const matchedEl = document.getElementById('streamMatchedCount');
  const totalEl = document.getElementById('streamTotalCount');
  const list = document.getElementById('streamFieldList');

  if (fill) fill.style.width = `${total > 0 ? (matched / total) * 100 : 0}%`;
  if (matchedEl) matchedEl.textContent = String(matched);
  if (totalEl) totalEl.textContent = String(total);

  if (list) {
    const item = document.createElement('div');
    item.className = 'stream-field-item done';
    item.innerHTML = `
      <span class="stream-dot filled"></span>
      <span class="stream-field-label">${escapeHtml(latestLabel)}</span>
      <span class="stream-field-status filled">已填充</span>
    `;
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
  }
}

function renderStreamComplete(matched: number, errorCount: number) {
  viewState = 'filled';
  removeFooter();
  const main = getMainContainer(false);
  main.innerHTML = `
    <div class="result-msg">
      <div class="icon success">✓</div>
      <div class="text">流式填充完成</div>
      <div class="sub">成功填充 ${matched} 个字段${errorCount > 0 ? `，${errorCount} 个失败` : ''}</div>
    </div>
  `;
  const btn = document.createElement('button');
  btn.className = 'scan-btn';
  btn.style.marginTop = '20px';
  btn.style.maxWidth = '200px';
  btn.textContent = '关闭';
  btn.addEventListener('click', () => window.close());
  main.querySelector('.result-msg')!.appendChild(btn);
}

function renderStreamError(error: string) {
  viewState = 'idle';
  removeFooter();
  const main = getMainContainer(false);
  main.innerHTML = `
    <div class="result-msg">
      <div class="icon error">✕</div>
      <div class="text">流式填充失败</div>
      <div class="sub">${escapeHtml(error)}</div>
    </div>
  `;
  const btn = document.createElement('button');
  btn.className = 'scan-btn';
  btn.style.marginTop = '20px';
  btn.style.maxWidth = '200px';
  btn.textContent = '重试';
  btn.addEventListener('click', startStreamScan);
  main.querySelector('.result-msg')!.appendChild(btn);
}

init().catch((err) => {
  renderHeader();
  showError(err instanceof Error ? err.message : '插件初始化失败');
});
