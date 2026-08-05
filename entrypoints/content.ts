import { fieldFingerprint } from '@/utils/field-fingerprint';

interface FormField {
  kind: 'text' | 'file';
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  ariaLabel: string;
  title: string;
  dateFormat?: string;
  value: string;
  options: string[];
  accept: string;
  multiple: boolean;
  hasExistingFile: boolean;
  fillMode: 'short' | 'long';
  renderWidth: number;
  renderHeight: number;
  context: string;
  html: string;
  required: boolean;
  groupLabel: string;
  columnLabel: string;
  rowIndex?: number;
  repeatGroup: string;
  selectionMode?: 'dialog';
  protected: boolean;
  protectionReason: string;
}

interface FieldResult {
  index: number;
  field: FormField;
}

interface TextFillItem {
  kind?: 'text';
  index: number;
  value: string;
  confidence?: 'high' | 'medium' | 'low';
}

interface FileFillItem {
  kind: 'file';
  index: number;
  fileName: string;
  fileType: string;
  fileBody: string;
}

type FillItem = TextFillItem | FileFillItem;

interface FillResult {
  success: number;
  failure: number;
}

interface ScanMessage { type: 'scan' }
interface FillMessage { type: 'fill'; items: FillItem[] }
interface FillStreamInitMessage { type: 'fillStreamInit'; items: Array<{ index: number; fillMode: 'short' | 'long' }> }
interface FillFieldMessage { type: 'fillField'; index: number; value: string; confidence?: 'high' | 'medium' | 'low' }
interface FillTypeChunkMessage { type: 'fillTypeChunk'; index: number; chunk: string }
interface FillTypeCommitMessage { type: 'fillTypeCommit'; index: number }
interface FillStreamCompleteMessage { type: 'fillStreamComplete' }
interface ManualFillMessage { type: 'manualFill'; value: string }
interface PrepareRepeatRowsMessage { type: 'prepareRepeatRows'; targets: Array<{ groupLabel: string; count: number }> }
interface AdvanceToNextStepMessage { type: 'advanceToNextStep' }
interface MarkPreviewMessage {
  type: 'markPreview';
  items: Array<{ index: number; fingerprint?: string; status: 'verified' | 'review' | 'mismatch'; message?: string }>;
}
interface FocusFieldMessage { type: 'focusField'; index: number }
interface GetPageMetaMessage { type: 'getPageMeta' }
type Message = ScanMessage | FillMessage | FillStreamInitMessage | FillFieldMessage | FillTypeChunkMessage | FillTypeCommitMessage | FillStreamCompleteMessage | ManualFillMessage | PrepareRepeatRowsMessage | AdvanceToNextStepMessage | MarkPreviewMessage | FocusFieldMessage | GetPageMetaMessage;

let elementMap = new Map<number, HTMLElement>();
let protectedIndices = new Set<number>();
let lastFocusedElement: HTMLElement | null = null;

function findLabel(el: HTMLElement): string {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const text = label?.textContent?.trim() ?? '';
    if (text) return text;
  }

  const parentLabel = el.closest('label');
  if (parentLabel) {
    // Exclude the element's own text from the label
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
    const text = clone.textContent?.trim() ?? '';
    if (text) return text;
  }

  // Use aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const refEl = document.getElementById(labelledBy);
    if (refEl) return refEl.textContent?.trim() ?? '';
  }

  const row = el.closest('tr');
  const valueCell = el.closest('td, th');
  if (row && valueCell) {
    const cells = Array.from(row.querySelectorAll<HTMLElement>('td, th'));
    const valueCellIndex = cells.indexOf(valueCell as HTMLElement);
    const precedingCells = cells.slice(0, Math.max(valueCellIndex, 0));
    const labelCell = el instanceof HTMLInputElement && el.type === 'file'
      ? precedingCells.find((cell) => {
        const text = textWithoutControls(cell);
        return text.length >= 2 && text.length <= 100 && !/^(pdf|jpe?g|png|是|否|必填|选填|required|optional|\d+)$/i.test(text);
      })
      : precedingCells.reverse().find((cell) => textWithoutControls(cell));
    if (labelCell) return textWithoutControls(labelCell);
  }

  return '';
}

const EDITABLE_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="image"]):not([type="file"])',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
].join(',');

const FILE_SELECTOR = 'input[type="file"]';
const SCANNABLE_SELECTOR = `${EDITABLE_SELECTOR},${FILE_SELECTOR}`;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isVisible(el: HTMLElement): boolean {
  const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

function hasVisibleFileTrigger(input: HTMLInputElement): boolean {
  if (input.disabled) return false;
  if (input.id) {
    const label = document.querySelector<HTMLElement>(`label[for="${CSS.escape(input.id)}"]`);
    if (label && isVisible(label)) return true;
  }
  let container: HTMLElement | null = input.parentElement;
  for (let depth = 0; container && container !== document.body && depth < 4; depth++, container = container.parentElement) {
    const trigger = Array.from(container.querySelectorAll<HTMLElement>(
      'button,input[type="button"],a,[role="button"],label,.btn,[class*="upload"],[class*="select"]',
    )).find((candidate) => candidate !== input && isVisible(candidate));
    if (trigger) return true;
    if (container.matches('tr,.form-group,.form-item,.form-row,.ant-form-item,.el-form-item')) break;
  }
  return false;
}

function findSelectionTrigger(el: HTMLElement): HTMLElement | null {
  let container: HTMLElement | null = el.parentElement;
  for (let depth = 0; container && container !== document.body && depth < 4; depth++, container = container.parentElement) {
    const controls = Array.from(container.querySelectorAll<HTMLElement>(
      'button,input[type="button"],a,[role="button"],span,.add-on',
    ));
    const trigger = controls.find((candidate) => {
      if (!isVisible(candidate) || (candidate as HTMLButtonElement).disabled) return false;
      const text = normalizeText((candidate as HTMLInputElement).value || candidate.textContent || '');
      return /^(选择|请选择|选取)$/.test(text);
    });
    if (trigger) return trigger;
    if (container.matches('tr,.form-group,.form-item,.form-row,.ant-form-item,.el-form-item')) break;
  }
  return null;
}

function isSupportedDialogSelection(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  return Boolean(findSelectionTrigger(el));
}

function isSupportedDatePicker(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || !el.readOnly) return false;
  const trigger = el.getAttribute('onclick') ?? '';
  const text = joinUnique([findLabel(el), el.name, el.id, el.placeholder]);
  return /WdatePicker|datePicker|datepicker/i.test(trigger) && /日期|年月|时间|入学|毕业/.test(text);
}

function isFillable(el: HTMLElement): boolean {
  if (!el.matches(SCANNABLE_SELECTOR)) return false;
  if (el instanceof HTMLInputElement && el.type === 'file') {
    return isVisible(el) || hasVisibleFileTrigger(el);
  }
  return isVisible(el);
}

function countEditables(el: HTMLElement): number {
  return Array.from(el.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR)).filter(isFillable).length;
}

// Walk up from the deepest editable node until the current container holds
// multiple fillable controls; that is the widest useful context boundary.
function textWithoutControls(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('input, select, textarea, option, script, style, svg, button')
    .forEach((child) => child.remove());
  return normalizeText(clone.textContent ?? '');
}

function getOptions(el: HTMLElement): string[] {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options)
      .map((option) => normalizeText(option.textContent ?? option.value))
      .filter(Boolean)
      .slice(0, 20);
  }

  const optionContainerIds = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
  if (!optionContainerIds) return [];

  return optionContainerIds
    .split(/\s+/)
    .flatMap((id) => Array.from(document.getElementById(id)?.querySelectorAll('[role="option"]') ?? []))
    .map((option) => normalizeText(option.textContent ?? ''))
    .filter(Boolean)
    .slice(0, 20);
}

function getCurrentValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement && el.type === 'file') {
    return Array.from(el.files ?? []).map((file) => file.name).join(', ');
  }
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    return el.checked ? (el.value || 'true') : '';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) {
    return normalizeText(el.selectedOptions[0]?.textContent ?? el.value);
  }
  return normalizeText(el.textContent ?? '');
}

function getRenderedSize(el: HTMLElement): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function classifyFillMode(el: HTMLElement, width: number, height: number): 'short' | 'long' {
  if (el instanceof HTMLSelectElement) return 'short';
  if (el instanceof HTMLInputElement && el.type !== 'file') return height >= 96 ? 'long' : 'short';
  if (el instanceof HTMLInputElement && el.type === 'file') return 'short';

  const area = width * height;
  if (height >= 96 || area >= 32000) return 'long';
  return 'short';
}

function findContextRoot(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    if (countEditables(node) > 1) {
      return node;
    }
    node = node.parentElement;
  }
  return el.closest('form') ?? document.body;
}

function findNearestSingleFieldContainer(el: HTMLElement, contextRoot: HTMLElement): HTMLElement {
  let node: HTMLElement = el;
  while (node.parentElement && node.parentElement !== contextRoot && countEditables(node.parentElement) <= 1) {
    node = node.parentElement;
  }
  return node;
}

function findNearbyText(el: HTMLElement, contextRoot: HTMLElement): string {
  const parts: string[] = [];
  let current: ChildNode | null = el.previousSibling;

  while (current) {
    if (current instanceof HTMLElement && current.matches(SCANNABLE_SELECTOR) && isFillable(current)) break;
    const text = normalizeText(current.textContent ?? '');
    if (text) parts.unshift(text);
    current = current.previousSibling;
  }

  current = el.nextSibling;
  while (current) {
    if (current instanceof HTMLElement && current.matches(SCANNABLE_SELECTOR) && isFillable(current)) break;
    const text = normalizeText(current.textContent ?? '');
    if (text) parts.push(text);
    current = current.nextSibling;
  }

  return parts.join(' ');
}

function joinUnique(parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const text = normalizeText(part ?? '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }

  return result.join(' | ');
}

interface RepeatFieldMeta {
  groupLabel: string;
  columnLabel: string;
  rowIndex?: number;
  repeatGroup: string;
}

function detectProfileGroup(text: string): string {
  const normalized = normalizeText(text);
  const aliases: Array<[string, RegExp]> = [
    ['家庭成员', /家庭|社会关系|父亲|母亲|家长/],
    ['学习和工作经历', /学习.{0,3}工作经历|教育经历|工作经历|学习经历/],
    ['学术成果', /学术成果|科研成果|论文|专利|著作|竞赛成果/],
    ['奖励情况', /奖励|获奖|荣誉|奖惩|学科竞赛|专业竞赛|竞赛经历|比赛经历/],
    ['外语水平', /外语|英语|四六级|雅思|托福/],
    ['学习信息', /学习信息|学籍|教育信息|本科信息|成绩信息/],
    ['基本信息', /基本信息|个人信息/],
  ];
  return aliases.find(([, pattern]) => pattern.test(normalized))?.[0] ?? '';
}

function findGroupText(el: HTMLElement, table: HTMLTableElement | null): string {
  const parts: string[] = [];
  if (table) {
    parts.push(textWithoutControls(table));
    const caption = table.querySelector('caption');
    if (caption) parts.push(normalizeText(caption.textContent ?? ''));
  }

  let node: HTMLElement | null = table ?? el;
  for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
    const heading = node.querySelector<HTMLElement>('h1,h2,h3,h4,legend,.title,.form-title,.panel-title,.info-group');
    if (heading) parts.push(normalizeText(heading.textContent ?? ''));
    let previous = node.previousElementSibling as HTMLElement | null;
    for (let i = 0; previous && i < 2; i++, previous = previous.previousElementSibling as HTMLElement | null) {
      parts.push(textWithoutControls(previous));
    }
  }

  return joinUnique(parts);
}

function inferProfileGroupFromTable(table: HTMLTableElement): string {
  const headerText = Array.from(table.querySelectorAll<HTMLElement>('th,thead td'))
    .map((cell) => textWithoutControls(cell))
    .filter(Boolean)
    .join('|');
  if (/姓名/.test(headerText) && /关系/.test(headerText) && /(联系电话|工作单位|职务)/.test(headerText)) {
    return '家庭成员';
  }
  if (/(外语|考试|等级)/.test(headerText) && /成绩/.test(headerText)) return '外语水平';
  if (/(获奖|奖励|奖项|竞赛)/.test(headerText) && /(名称|等级|级别|时间|日期)/.test(headerText)) {
    return '奖励情况';
  }
  if (/(论文|专利|成果|项目)/.test(headerText) && /(名称|类型|时间|排序)/.test(headerText)) {
    return '学术成果';
  }
  if (/(开始|起始)/.test(headerText) && /(结束|终止)/.test(headerText) && /(学校|单位|职务|专业)/.test(headerText)) {
    return '学习和工作经历';
  }
  return '';
}

function findNearestHeadingText(el: HTMLElement): string {
  const headings = Array.from(document.querySelectorAll<HTMLElement>(
    'h1,h2,h3,h4,legend,.title,.form-title,.panel-title,.info-group',
  ));
  const preceding = headings.filter((heading) => (
    heading === el || Boolean(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
  ));
  return normalizeText(preceding.at(-1)?.textContent ?? '');
}

function getTableColumnLabel(el: HTMLElement, table: HTMLTableElement, row: HTMLTableRowElement): string {
  const rowInputs = Array.from(row.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR)).filter(isFillable);
  const inputIndex = rowInputs.indexOf(el);
  const precedingRows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
    .filter((candidate) => candidate !== row && (candidate.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING))
    .filter((candidate) => countEditables(candidate) === 0);
  const headerRow = precedingRows.reverse().find((candidate) => {
    const labels = Array.from(candidate.cells).map((cell) => textWithoutControls(cell)).filter(Boolean);
    return labels.length >= Math.max(2, rowInputs.length);
  });

  if (!headerRow) return '';
  const headerCells = Array.from(headerRow.cells).filter((cell) => textWithoutControls(cell));
  if (inputIndex >= 0 && headerCells[inputIndex]) return textWithoutControls(headerCells[inputIndex]);

  const centerX = el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2;
  const closest = headerCells
    .map((cell) => {
      const rect = cell.getBoundingClientRect();
      return { cell, distance: Math.abs(centerX - (rect.left + rect.width / 2)) };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.cell;
  return closest ? textWithoutControls(closest) : '';
}

function getRepeatFieldMeta(el: HTMLElement): RepeatFieldMeta {
  const row = el.closest<HTMLTableRowElement>('tr');
  const table = el.closest<HTMLTableElement>('table');
  const groupText = findGroupText(el, table);
  const nearestHeading = findNearestHeadingText(el);
  const groupLabel = table
    ? inferProfileGroupFromTable(table) || detectProfileGroup(nearestHeading)
    : detectProfileGroup(nearestHeading || groupText);
  const repeatProfileGroups = new Set(['家庭成员', '外语水平', '学习和工作经历', '学术成果', '奖励情况']);

  if (!row || !table || !repeatProfileGroups.has(groupLabel)) {
    return {
      groupLabel,
      columnLabel: '',
      repeatGroup: groupLabel,
    };
  }

  const dataRows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
    .filter((candidate) => countEditables(candidate) >= 2);
  const rowIndex = dataRows.indexOf(row);
  const columnLabel = getTableColumnLabel(el, table, row);

  return {
    groupLabel,
    columnLabel,
    rowIndex: rowIndex >= 0 ? rowIndex : undefined,
    repeatGroup: groupLabel || normalizeText(table.getAttribute('id') ?? table.getAttribute('class') ?? ''),
  };
}

function repeatDataRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
    .filter((candidate) => countEditables(candidate) >= 2);
}

function findRepeatTable(groupLabel: string): HTMLTableElement | undefined {
  return Array.from(document.querySelectorAll<HTMLTableElement>('table')).find((table) => (
    detectProfileGroup(findGroupText(table, table)) === groupLabel
  ));
}

function findAddRowControl(table: HTMLTableElement): HTMLElement | undefined {
  let container: HTMLElement | null = table.parentElement;
  for (let depth = 0; container && container !== document.body && depth < 5; depth++, container = container.parentElement) {
    const control = Array.from(container.querySelectorAll<HTMLElement>('button,a,[role="button"]')).find((candidate) => {
      if (!isVisible(candidate) || (candidate as HTMLButtonElement).disabled) return false;
      const text = normalizeText(candidate.textContent ?? '').replace(/\s+/g, '');
      return /^(新增|添加)(一行|行|一条|成员|经历|记录)$/.test(text);
    });
    if (control) return control;
  }
  return undefined;
}

async function waitForRowIncrease(table: HTMLTableElement, previousCount: number): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (repeatDataRows(table).length > previousCount) return true;
  }
  return false;
}

async function prepareRepeatRows(targets: Array<{ groupLabel: string; count: number }>): Promise<number> {
  let added = 0;
  for (const target of targets) {
    const table = findRepeatTable(target.groupLabel);
    if (!table) continue;
    const safeTarget = Math.min(Math.max(Math.floor(target.count), 0), 10);
    while (repeatDataRows(table).length < safeTarget) {
      const previousCount = repeatDataRows(table).length;
      const control = findAddRowControl(table);
      if (!control) break;
      control.click();
      if (!await waitForRowIncrease(table, previousCount)) break;
      added++;
    }
  }
  return added;
}

function nextPageSignature(): string {
  const headings = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,legend,.title,.form-title,.panel-title'))
    .filter(isVisible)
    .map((heading) => normalizeText(heading.textContent ?? ''))
    .join('|');
  const controls = Array.from(document.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR))
    .filter(isFillable)
    .map((control) => `${control.tagName}:${control.getAttribute('name') ?? ''}:${control.getAttribute('id') ?? ''}`)
    .join('|');
  return `${location.href}::${headings}::${controls}`;
}

function getPageMeta(): { label: string; url: string; signature: string } {
  const activeNavigation = Array.from(document.querySelectorAll<HTMLElement>(
    'nav .active,aside .active,[role="navigation"] .active,.sidebar .active,.side-menu .active,.menu .active,ul .active,ol .active',
  ))
    .filter(isVisible)
    .map((element) => normalizeText(element.textContent ?? ''))
    .find((text) => text.length >= 2 && text.length <= 24);
  const preferred = Array.from(document.querySelectorAll<HTMLElement>(
    '.page-title,.panel-title,.form-title,.section-title,.card-title,main h1,main h2,main h3,h1,h2,h3,legend',
  ))
    .filter(isVisible)
    .map((element) => normalizeText(element.textContent ?? ''))
    .filter((text) => (
      text.length >= 2 &&
      text.length <= 40 &&
      !/研究生报考服务系统|接收推荐免试研究生报名|^首页$/.test(text)
    ));
  return {
    label: activeNavigation ?? preferred.at(-1) ?? document.title ?? '当前页面',
    url: location.href,
    signature: nextPageSignature(),
  };
}

function findSafeNextControl(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    'button,input[type="button"],input[type="submit"],a,[role="button"]',
  ));
  return candidates.find((candidate) => {
    if (!isVisible(candidate) || (candidate as HTMLButtonElement).disabled) return false;
    const text = normalizeText((candidate as HTMLInputElement).value || candidate.textContent || '').replace(/\s+/g, '');
    if (/提交|确认提交|完成申请|支付|缴费|删除/.test(text)) return false;
    return /^(下一步|保存并下一步|保存后下一步|保存并继续|继续下一步)$/.test(text);
  }) ?? null;
}

async function advanceToNextStep(): Promise<{ clicked: boolean; advanced: boolean; reason: string }> {
  const control = findSafeNextControl();
  if (!control) return { clicked: false, advanced: false, reason: '已到最终审核页或未找到安全的下一步按钮' };
  const before = nextPageSignature();
  control.scrollIntoView({ behavior: 'smooth', block: 'center' });
  control.click();

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (nextPageSignature() !== before) {
      return { clicked: true, advanced: true, reason: '已进入下一页' };
    }
  }
  return { clicked: true, advanced: false, reason: '页面没有切换，可能仍有校验项需要本人处理' };
}

function getProtection(el: HTMLElement, fieldText: string, isFile: boolean): { protected: boolean; reason: string } {
  if (isFile) return { protected: true, reason: '文件上传需本人确认' };
  if ((el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled && !isSupportedDialogSelection(el)) {
    return { protected: true, reason: '页面已锁定该字段' };
  }
  if (
    (el as HTMLInputElement | HTMLTextAreaElement).readOnly &&
    !isSupportedDialogSelection(el) &&
    !isSupportedDatePicker(el)
  ) {
    return { protected: true, reason: '页面只读字段' };
  }
  if (/验证码|短信码|图形码|动态码/.test(fieldText)) return { protected: true, reason: '验证码不自动填写' };
  if (/承诺书|诚信承诺|同意条款|本人承诺/.test(fieldText)) return { protected: true, reason: '承诺与协议需本人操作' };
  if (/支付|缴费|付款/.test(fieldText)) return { protected: true, reason: '支付操作不自动处理' };
  if (/志愿|导师|调剂/.test(fieldText)) return { protected: true, reason: '志愿和导师选择需本人决定' };

  const isCustomCombo = el.getAttribute('role') === 'combobox' && !(el instanceof HTMLSelectElement);
  if (isCustomCombo && /地区|学校|专业/.test(fieldText) && !isSupportedDialogSelection(el)) {
    return { protected: true, reason: '弹窗选择需本人确认' };
  }
  return { protected: false, reason: '' };
}

function getPairedSelectorLabel(el: HTMLElement): string {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return '';
  const container = el.closest<HTMLElement>('tr,.form-row,.form-group,.form-item,.ant-form-item,.el-form-item');
  if (!container) return '';
  const textInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="button"])'));
  const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));
  if (textInputs.length !== 1 || selects.length !== 1) return '';
  return normalizeText(selects[0].selectedOptions[0]?.textContent ?? selects[0].value);
}

function getSemanticContainer(el: HTMLElement): HTMLElement {
  const row = el.closest<HTMLElement>('tr');
  if (row) return row;

  const fieldWrapper = el.closest<HTMLElement>(
    '.form-group, .field, .form-item, .form-row, .ant-form-item, .el-form-item, label',
  );
  if (fieldWrapper) return fieldWrapper;

  return findNearestSingleFieldContainer(el, findContextRoot(el));
}

function findExistingFileEvidence(input: HTMLInputElement): string {
  const selectedName = Array.from(input.files ?? []).map((file) => file.name).filter(Boolean).join(', ');
  if (selectedName) return selectedName;

  const container = getSemanticContainer(input);
  const text = normalizeText(container.textContent ?? '');
  const filename = text.match(/[^\\/\s<>:"|?*]+\.(?:pdf|docx?|jpe?g|png|gif|webp|zip|rar)\b/i)?.[0];
  if (filename) return `已上传：${filename}`;

  const existingAction = Array.from(container.querySelectorAll<HTMLElement>('a[href],button,[role="button"]'))
    .find((candidate) => candidate !== input && isVisible(candidate) && /查看|下载|删除|替换|重新上传/.test(normalizeText(candidate.textContent ?? '')));
  if (existingAction) return '已上传材料';

  const explicitStatus = text.match(/(?:文件|材料|附件)?已上传|上传成功/);
  if (explicitStatus) return explicitStatus[0];

  const previewImage = Array.from(container.querySelectorAll<HTMLImageElement>('img[src]')).find((image) => {
    if (!isVisible(image)) return false;
    const descriptor = `${image.alt} ${image.className} ${image.src}`.toLowerCase();
    if (/logo|icon|captcha|verify|qrcode|二维码|验证码/.test(descriptor)) return false;
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || rect.width;
    const height = image.naturalHeight || rect.height;
    return width >= 60 && height >= 60;
  });
  return previewImage ? '已上传图片' : '';
}

function sanitizeHtml(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, svg, iframe, canvas').forEach((child) => child.remove());

  clone.querySelectorAll<HTMLElement>('*').forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const keep =
        ['id', 'name', 'type', 'placeholder', 'title', 'aria-label', 'role'].includes(name) ||
        name.startsWith('data-');
      if (!keep || name.startsWith('on')) {
        node.removeAttribute(attr.name);
      }
    });

    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.removeAttribute('value');
    }
  });

  return normalizeText(clone.outerHTML).slice(0, 800);
}

function findContext(el: HTMLElement): string {
  const contextRoot = findContextRoot(el);
  const singleFieldContainer = findNearestSingleFieldContainer(el, contextRoot);
  const localText = textWithoutControls(singleFieldContainer);
  const nearbyText = findNearbyText(el, contextRoot);

  return joinUnique([localText, nearbyText]);
}

function findHint(el: HTMLElement, label: string, context: string): string {
  const singleFieldContainer = findNearestSingleFieldContainer(el, findContextRoot(el));
  const localText = textWithoutControls(singleFieldContainer);
  const hint = localText
    .replace(label, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return hint || context.replace(label, '').trim();
}

function isRequiredField(el: HTMLElement, fieldText: string): boolean {
  if ((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true') return true;
  const row = el.closest<HTMLTableRowElement>('tr');
  const valueCell = el.closest<HTMLTableCellElement>('td,th');
  if (row && valueCell) {
    const preceding = Array.from(row.cells).slice(0, row.cells.length).filter((cell) => cell !== valueCell);
    const explicit = preceding
      .map((cell) => textWithoutControls(cell).toLowerCase())
      .find((text) => /^(是|否|必填|选填|required|optional)$/.test(text));
    if (explicit) return /^(是|必填|required)$/.test(explicit);
  }
  return /必填|不能为空|\*/.test(fieldText);
}

function extractField(el: HTMLElement): FormField {
  const tag = el.tagName.toLowerCase();
  const isFile = el instanceof HTMLInputElement && el.type === 'file';
  const renderedSize = getRenderedSize(el);
  const context = findContext(el);
  const repeatMeta = getRepeatFieldMeta(el);
  const label = repeatMeta.columnLabel || getPairedSelectorLabel(el) || findLabel(el);
  const hint = findHint(el, label, context);
  const fieldText = joinUnique([repeatMeta.groupLabel, repeatMeta.columnLabel, label, hint, context]);
  const protection = getProtection(el, fieldText, isFile);
  const required = isRequiredField(el, fieldText);
  const dateFormat = [
    el.getAttribute('data-date-format'),
    el.getAttribute('data-datefmt'),
    el.getAttribute('onclick')?.match(/dateFmt\s*:\s*['"]([^'"]+)['"]/i)?.[1],
  ].find(Boolean) ?? '';
  const existingFile = isFile ? findExistingFileEvidence(el as HTMLInputElement) : '';
  return {
    kind: isFile ? 'file' : 'text',
    tag,
    type: (el as HTMLInputElement).type ?? tag,
    name: el.getAttribute('name') ?? '',
    id: el.getAttribute('id') ?? '',
    label,
    hint,
    placeholder: el.getAttribute('placeholder') ?? '',
    ariaLabel: el.getAttribute('aria-label') ?? '',
    title: el.getAttribute('title') ?? '',
    dateFormat,
    value: isFile ? (getCurrentValue(el) || existingFile) : getCurrentValue(el),
    options: getOptions(el),
    accept: isFile ? el.accept : '',
    multiple: isFile ? el.multiple : false,
    hasExistingFile: Boolean(existingFile),
    fillMode: classifyFillMode(el, renderedSize.width, renderedSize.height),
    renderWidth: renderedSize.width,
    renderHeight: renderedSize.height,
    context,
    html: sanitizeHtml(getSemanticContainer(el)),
    required,
    ...repeatMeta,
    selectionMode: isSupportedDialogSelection(el) ? 'dialog' : undefined,
    protected: protection.protected,
    protectionReason: protection.reason,
  };
}

function scanFields(): FieldResult[] {
  elementMap.clear();
  protectedIndices.clear();

  const elements = document.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR);
  const results: FieldResult[] = [];
  let index = 0;

  elements.forEach((el) => {
    if (!isFillable(el)) return;

    const field = extractField(el);
    elementMap.set(index, el);
    if (field.protected) protectedIndices.add(index);
    results.push({ index, field });
    index++;
  });

  return results;
}

function isAcceptedFileType(accept: string, fileName: string, fileType: string): boolean {
  const rules = accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;

  const lowerName = fileName.toLowerCase();
  const lowerType = fileType.toLowerCase();
  return rules.some((rule) => {
    if (rule === '*/*') return true;
    if (rule.endsWith('/*')) return lowerType.startsWith(rule.slice(0, -1));
    if (rule.startsWith('.')) return lowerName.endsWith(rule);
    return lowerType === rule;
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function ensureMarkerStyles(): void {
  if (document.getElementById('auto-filler-marker-styles')) return;
  const style = document.createElement('style');
  style.id = 'auto-filler-marker-styles';
  style.textContent = `
    [data-auto-filler-status="verified"] { outline: 2px solid #22c55e !important; outline-offset: 2px !important; }
    [data-auto-filler-status="review"] { outline: 2px solid #f59e0b !important; outline-offset: 2px !important; }
    [data-auto-filler-status="mismatch"] { outline: 2px solid #ef4444 !important; outline-offset: 2px !important; }
    [data-auto-filler-located="true"] { animation: auto-filler-locate 900ms ease-out 1 !important; }
    @keyframes auto-filler-locate {
      0%, 100% { box-shadow: none; }
      35% { box-shadow: 0 0 0 7px rgba(37, 127, 253, .28); }
    }
  `;
  document.documentElement.appendChild(style);
}

function markField(el: HTMLElement, status: 'verified' | 'review' | 'mismatch', message?: string): void {
  ensureMarkerStyles();
  if (el.dataset.autoFillerOriginalTitle == null) {
    el.dataset.autoFillerOriginalTitle = el.getAttribute('title') ?? '';
  }
  el.dataset.autoFillerStatus = status;
  const markerTitle = message ?? (status === 'verified'
    ? '保填：已填写并回读一致'
    : status === 'review'
      ? '保填：已填写，建议确认'
      : '保填：页面回读不一致，请手动检查');
  el.title = [el.dataset.autoFillerOriginalTitle, markerTitle].filter(Boolean).join(' | ');
}

function clearPreviewMarkers(): void {
  document.querySelectorAll<HTMLElement>('[data-auto-filler-status]').forEach((el) => {
    delete el.dataset.autoFillerStatus;
    const originalTitle = el.dataset.autoFillerOriginalTitle;
    if (originalTitle != null) {
      if (originalTitle) el.setAttribute('title', originalTitle);
      else el.removeAttribute('title');
      delete el.dataset.autoFillerOriginalTitle;
    }
  });
}

function markPreviewFields(items: MarkPreviewMessage['items']): number {
  const scanned = scanFields();
  clearPreviewMarkers();
  const byFingerprint = new Map<string, HTMLElement[]>();
  for (const result of scanned) {
    const fingerprint = fieldFingerprint({ ...result.field, index: result.index });
    const candidates = byFingerprint.get(fingerprint) ?? [];
    const element = elementMap.get(result.index);
    if (element) candidates.push(element);
    byFingerprint.set(fingerprint, candidates);
  }
  const used = new Set<HTMLElement>();
  let marked = 0;
  for (const item of items) {
    const indexed = elementMap.get(item.index);
    const indexedField = scanned.find((result) => result.index === item.index)?.field;
    const indexStillMatches = indexed && (!item.fingerprint || (
      indexedField && fieldFingerprint({ ...indexedField, index: item.index }) === item.fingerprint
    ));
    const el = indexStillMatches
      ? indexed
      : byFingerprint.get(item.fingerprint ?? '')?.find((candidate) => !used.has(candidate));
    if (!el) continue;
    markField(el, item.status, item.message);
    used.add(el);
    marked++;
  }
  return marked;
}

function focusField(index: number): boolean {
  const el = elementMap.get(index);
  if (!el) return false;
  ensureMarkerStyles();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  el.dataset.autoFillerLocated = 'true';
  window.setTimeout(() => { delete el.dataset.autoFillerLocated; }, 950);
  return true;
}

function valueMatches(el: HTMLElement, expected: string): boolean {
  if (el instanceof HTMLInputElement && el.type === 'radio') {
    return el.checked && normalizeText(el.value).toLowerCase() === normalizeText(expected).toLowerCase();
  }
  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    const shouldBeChecked = expected === 'true' || expected === '1' || expected === el.value;
    return el.checked === shouldBeChecked;
  }
  const actual = getCurrentValue(el);
  const normalizedExpected = normalizeText(expected).toLowerCase();
  const normalizedActual = normalizeText(actual).toLowerCase();
  if (el instanceof HTMLSelectElement) {
    return normalizedActual === normalizedExpected || normalizeText(el.value).toLowerCase() === normalizedExpected;
  }
  return normalizedActual === normalizedExpected;
}

function getVisibleDialogRoots(): HTMLElement[] {
  const roots = Array.from(document.querySelectorAll<HTMLElement>(
    '[role="dialog"],.modal,.dialog,.popup,.layui-layer,.ui-dialog,.el-dialog,.ant-modal,.window',
  )).filter(isVisible);
  for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).filter(isVisible)) {
    try {
      const body = frame.contentDocument?.body;
      if (body) roots.push(body);
    } catch {
      // Cross-origin dialog frames cannot be automated safely.
    }
  }
  return roots.length ? roots : [document.body];
}

function normalizeSelectionText(text: string): string {
  return normalizeText(text).trim();
}

async function waitForDialogChoice(value: string, timeoutMs = 2500): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  const wanted = normalizeSelectionText(value);
  const comparable = (text: string) => normalizeSelectionText(text).replace(/^\d{4,12}\s*/, '');
  while (Date.now() < deadline) {
    const candidates = getVisibleDialogRoots().flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(
      '[role="option"],li,td,a,button,.option,.item,.tree-node,.el-tree-node__label,.ant-select-item-option-content',
    ))).filter((candidate) => isVisible(candidate) && candidate.childElementCount <= 3);
    const exact = candidates
      .filter((candidate) => {
        const text = normalizeSelectionText(candidate.textContent ?? '');
        return text === wanted || comparable(text) === comparable(wanted);
      })
      .sort((a, b) => normalizeSelectionText(a.textContent ?? '').length - normalizeSelectionText(b.textContent ?? '').length)[0];
    if (exact) {
      const clickableChild = Array.from(exact.querySelectorAll<HTMLElement>(
        'a,button,[role="option"],[role="treeitem"],.option,.item,.tree-node,.el-tree-node__label,.ant-select-item-option-content',
      )).find((candidate) => comparable(candidate.textContent ?? '') === comparable(wanted));
      return clickableChild ?? exact;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

function getTerminalSelectionTerm(value: string): string {
  const normalized = normalizeSelectionText(value).replace(/^\d{4,12}/, '');
  const delimited = normalized.split(/[|/>\\,，;；\s-]+/).filter(Boolean);
  if (delimited.length > 1) return delimited.at(-1) ?? normalized;
  const administrativeParts = normalized.match(/[^省市区县旗州盟]+?(?:特别行政区|自治区|自治州|地区|省|市|区|县|旗|盟)/g);
  return administrativeParts?.at(-1) ?? normalized;
}

function setDialogSearchValue(input: HTMLInputElement, value: string): void {
  const view = input.ownerDocument.defaultView;
  const prototype = view?.HTMLInputElement?.prototype;
  const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(input, value); else input.value = value;
  const EventConstructor = view?.Event ?? Event;
  input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
  input.dispatchEvent(new EventConstructor('change', { bubbles: true }));
}

async function searchDialogChoice(value: string): Promise<HTMLElement | null> {
  const term = getTerminalSelectionTerm(value);
  if (!term) return null;
  for (const root of getVisibleDialogRoots()) {
    const input = Array.from(root.querySelectorAll<HTMLInputElement>(
      'input[type="search"],input[type="text"],input:not([type])',
    )).find((candidate) => isVisible(candidate) && !candidate.disabled && !candidate.readOnly);
    if (!input) continue;
    const button = Array.from(root.querySelectorAll<HTMLElement>('button,a,input[type="button"],[role="button"]'))
      .find((candidate) => isVisible(candidate) && /^(搜索|查询|查找)$/.test(normalizeText(
        (candidate as HTMLInputElement).value || candidate.textContent || '',
      )));
    if (!button) continue;
    setDialogSearchValue(input, term);
    button.click();
    const choice = await waitForDialogChoice(term, 1800);
    if (choice) return choice;
  }
  return null;
}

function dialogValueMatches(el: HTMLElement, expected: string): boolean {
  if (valueMatches(el, expected)) return true;
  const actual = normalizeSelectionText(getCurrentValue(el)).replace(/^\d{4,12}/, '').replace(/[|/>\\,，;；\s-]+/g, '');
  const wanted = normalizeSelectionText(expected).replace(/^\d{4,12}/, '').replace(/[|/>\\,，;；\s-]+/g, '');
  return Boolean(actual && wanted && (actual.includes(wanted) || wanted.includes(actual)));
}

async function fillDialogSelection(
  el: HTMLElement,
  value: string,
  confidence: 'high' | 'medium' | 'low',
): Promise<boolean> {
  const trigger = findSelectionTrigger(el);
  if (!trigger) return false;
  trigger.click();
  let choice = await waitForDialogChoice(value, 1200);

  if (!choice) {
    choice = await searchDialogChoice(value);
  }

  if (!choice) {
    const search = getVisibleDialogRoots().flatMap((root) => Array.from(root.querySelectorAll<HTMLInputElement>(
      'input[type="text"],input:not([type])',
    ))).find((input) => input !== el && isVisible(input) && !input.readOnly && !input.disabled);
    if (search) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(search, value); else search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
      choice = await waitForDialogChoice(value, 1800);
    }
  }

  if (!choice) {
    markField(el, 'review');
    return false;
  }
  choice.click();
  await new Promise((resolve) => setTimeout(resolve, 150));

  if (!dialogValueMatches(el, value)) {
    const confirm = [
      ...Array.from(document.querySelectorAll<HTMLElement>('button,a,input[type="button"],[role="button"]')),
      ...getVisibleDialogRoots().flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>('button,a,input[type="button"],[role="button"]'))),
    ]
      .find((candidate) => isVisible(candidate) && /^(确定|确认|保存)$/.test(normalizeText(candidate.textContent ?? '')));
    confirm?.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  const verified = dialogValueMatches(el, value);
  markField(el, verified ? (confidence === 'high' ? 'verified' : 'review') : 'mismatch');
  return verified;
}

async function fillElementAsync(
  el: HTMLElement,
  value: string,
  confidence: 'high' | 'medium' | 'low' = 'medium',
): Promise<boolean> {
  if (isSupportedDialogSelection(el)) return fillDialogSelection(el, value, confidence);
  return fillElement(el, value, confidence);
}

function fillElement(el: HTMLElement, value: string, confidence: 'high' | 'medium' | 'low' = 'medium'): boolean {
  const field = extractField(el);
  if (field.protected) {
    markField(el, 'mismatch');
    return false;
  }

  try {
    const tag = el.tagName.toLowerCase();
    const type = (el as HTMLInputElement).type;

    if (type === 'radio') {
      const input = el as HTMLInputElement;
      if (input.value !== value) return false;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (type === 'checkbox') {
      const input = el as HTMLInputElement;
      input.checked = value === 'true' || value === '1' || value === input.value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const option = Array.from(select.options).find(
        (opt) => opt.value === value || opt.textContent?.trim() === value,
      );
      select.value = option ? option.value : value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (tag === 'textarea' || tag === 'input') {
      const target = el as HTMLInputElement | HTMLTextAreaElement;
      const prototype = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(target, value);
      else target.value = value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
    } else if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      return false;
    }

    const verified = valueMatches(el, value);
    markField(el, verified ? (confidence === 'high' ? 'verified' : 'review') : 'mismatch');
    return verified;
  } catch {
    markField(el, 'mismatch');
    return false;
  }
}

async function fillOneField(index: number, value: string, confidence: 'high' | 'medium' | 'low' = 'medium'): Promise<boolean> {
  const el = elementMap.get(index);
  if (!el || protectedIndices.has(index)) return false;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return fillElementAsync(el, value, confidence);
}

async function fillFields(items: FillItem[]): Promise<FillResult> {
  let success = 0;
  let failure = 0;

  for (const item of items) {
    if (item.kind === 'file') {
      const el = elementMap.get(item.index);
      if (!(el instanceof HTMLInputElement) || el.type !== 'file') { failure++; continue; }
      if (!isAcceptedFileType(el.accept, item.fileName, item.fileType)) { failure++; continue; }
      try {
        const file = new File([base64ToArrayBuffer(item.fileBody)], item.fileName, { type: item.fileType || 'application/octet-stream' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        el.files = dataTransfer.files;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        success++;
      } catch { failure++; }
    } else {
      await fillOneField(item.index, item.value, item.confidence) ? success++ : failure++;
    }
  }

  return { success, failure };
}

// ─── Typing animation for streaming fill ────────────────────────────

interface TypingEntry {
  el: HTMLElement;
  buffer: string;
  pos: number;
  timer: ReturnType<typeof setTimeout> | null;
  tag: string;
  isContentEditable: boolean;
  scrolled: boolean;
}

const typingMap = new Map<number, TypingEntry>();

function processTyping(index: number): void {
  const entry = typingMap.get(index);
  if (!entry) return;

  if (!entry.scrolled) {
    entry.scrolled = true;
    entry.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (entry.pos >= entry.buffer.length) {
    entry.timer = null;
    return;
  }

  const ch = entry.buffer[entry.pos];
  entry.pos++;

  if (entry.tag === 'input' || entry.tag === 'textarea') {
    const target = entry.el as HTMLInputElement | HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter && entry.tag === 'input') {
      nativeSetter.call(target, target.value + ch);
    } else {
      target.value += ch;
    }
  } else if (entry.isContentEditable) {
    entry.el.appendChild(document.createTextNode(ch));
  }

  entry.el.dispatchEvent(new Event('input', { bubbles: true }));

  if (entry.pos < entry.buffer.length) {
    entry.timer = setTimeout(() => processTyping(index), 30);
  } else {
    entry.timer = null;
  }
}

function enqueueTyping(index: number, chunk: string): void {
  const entry = typingMap.get(index);
  if (!entry) return;
  entry.buffer += chunk;
  if (!entry.timer) {
    entry.timer = setTimeout(() => processTyping(index), 0);
  }
}

function commitTyping(index: number): void {
  const entry = typingMap.get(index);
  if (!entry) return;
  // Fast-forward: type all remaining chars instantly
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  while (entry.pos < entry.buffer.length) {
    const ch = entry.buffer[entry.pos];
    entry.pos++;
    if (entry.tag === 'input' || entry.tag === 'textarea') {
      const target = entry.el as HTMLInputElement | HTMLTextAreaElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter && entry.tag === 'input') {
        nativeSetter.call(target, target.value + ch);
      } else {
        target.value += ch;
      }
    } else if (entry.isContentEditable) {
      entry.el.appendChild(document.createTextNode(ch));
    }
  }
  entry.el.dispatchEvent(new Event('input', { bubbles: true }));
  entry.el.dispatchEvent(new Event('change', { bubbles: true }));
  typingMap.delete(index);
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    document.addEventListener('focusin', (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches(SCANNABLE_SELECTOR) && isFillable(target)) {
        lastFocusedElement = target;
      }
    }, true);

    chrome.runtime.onMessage.addListener(
      (message: Message, _sender, sendResponse) => {
        if (message.type === 'scan') {
          const results = scanFields();
          sendResponse(results);
        } else if (message.type === 'getPageMeta') {
          sendResponse(getPageMeta());
        } else if (message.type === 'prepareRepeatRows') {
          prepareRepeatRows(message.targets)
            .then((added) => sendResponse({ ok: true, added }))
            .catch(() => sendResponse({ ok: false, added: 0 }));
        } else if (message.type === 'advanceToNextStep') {
          advanceToNextStep()
            .then(sendResponse)
            .catch(() => sendResponse({ clicked: false, advanced: false, reason: '无法安全进入下一页' }));
        } else if (message.type === 'markPreview') {
          sendResponse({ ok: true, marked: markPreviewFields(message.items) });
        } else if (message.type === 'focusField') {
          sendResponse({ ok: focusField(message.index) });
        } else if (message.type === 'fill') {
          fillFields(message.items).then(sendResponse).catch(() => sendResponse({ success: 0, failure: message.items.length }));
        } else if (message.type === 'fillStreamInit') {
          typingMap.clear();
          for (const item of message.items) {
            const el = elementMap.get(item.index);
            if (!el) continue;
            const tag = el.tagName.toLowerCase();
            const isContentEditable = el.isContentEditable || el.getAttribute('role') === 'textbox';
            if (item.fillMode === 'long') {
              // Clear existing content for long text fields
              if (tag === 'input' || tag === 'textarea') {
                (el as HTMLInputElement | HTMLTextAreaElement).value = '';
              } else if (isContentEditable) {
                el.textContent = '';
              }
            }
            typingMap.set(item.index, {
              el,
              buffer: '',
              pos: 0,
              timer: null,
              tag,
              isContentEditable,
              scrolled: false,
            });
          }
          sendResponse({ ok: true });
        } else if (message.type === 'fillField') {
          fillOneField(message.index, message.value, message.confidence)
            .then((success) => sendResponse({ ok: success }))
            .catch(() => sendResponse({ ok: false }));
        } else if (message.type === 'manualFill') {
          if (!lastFocusedElement) sendResponse({ ok: false });
          else fillElementAsync(lastFocusedElement, message.value, 'medium')
            .then((success) => sendResponse({ ok: success }))
            .catch(() => sendResponse({ ok: false }));
        } else if (message.type === 'fillTypeChunk') {
          enqueueTyping(message.index, message.chunk);
          sendResponse({ ok: true });
        } else if (message.type === 'fillTypeCommit') {
          commitTyping(message.index);
          sendResponse({ ok: true });
        } else if (message.type === 'fillStreamComplete') {
          typingMap.clear();
          sendResponse({ ok: true });
        }
        // Return true to keep the message channel open for async sendResponse
        return true;
      },
    );
  },
});
