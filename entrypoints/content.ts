import { fieldFingerprint } from '@/utils/field-fingerprint';
import { isSensitiveAuditField } from '@/utils/final-audit';
import type { WebsiteMaterialCandidate } from '@/utils/final-audit';
import { isAddRowLabel } from '@/utils/repeatable-records';
import {
  classifyRepeatPreparation,
  selectNewDialogRoot,
  selectScopedConfirm,
  selectScopedTrigger,
} from '@/utils/dom-selection-policy';
import {
  classifyRepeatDialogFields,
  hasVerifiedRepeatRecordChange,
  isProtectedRepeatDialogControl,
  planRepeatDialogAssignments,
  selectRepeatDialogRoot,
  selectRepeatDialogSaveCandidate,
} from '@/utils/repeatable-dialog';

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
interface PrepareRepeatRowsMessage {
  type: 'prepareRepeatRows';
  targets: Array<{ groupLabel: string; requiredRows: number; missingItemIndexes: number[] }>;
}
interface PrepareRepeatRowsResult {
  added: number;
  failures: Array<{ groupLabel: string; reason: string }>;
  dialogGroups?: string[];
}
interface PrepareRepeatRecordsMessage {
  type: 'prepareRepeatRecords';
  targets: Array<{
    groupLabel: string;
    records: Array<{
      itemIndex: number;
      fields: Array<{ key: string; value: string }>;
    }>;
  }>;
}
interface PrepareRepeatRecordsResult {
  added: number;
  processed: number;
  failures: Array<{
    groupLabel: string;
    itemIndex?: number;
    presentation: 'inline' | 'dialog';
    reason: string;
  }>;
}
interface AdvanceToNextStepMessage { type: 'advanceToNextStep' }
interface MarkPreviewMessage {
  type: 'markPreview';
  items: Array<{ index: number; fingerprint?: string; status: 'verified' | 'review' | 'mismatch'; message?: string }>;
}
interface FocusFieldMessage { type: 'focusField'; index: number }
interface GetPageMetaMessage { type: 'getPageMeta' }
interface GetAuditPageSnapshotMessage { type: 'getAuditPageSnapshot' }
type Message = ScanMessage | FillMessage | FillStreamInitMessage | FillFieldMessage | FillTypeChunkMessage | FillTypeCommitMessage | FillStreamCompleteMessage | ManualFillMessage | PrepareRepeatRowsMessage | PrepareRepeatRecordsMessage | AdvanceToNextStepMessage | MarkPreviewMessage | FocusFieldMessage | GetPageMetaMessage | GetAuditPageSnapshotMessage;

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

function discoverVisibleWebsiteMaterials(): WebsiteMaterialCandidate[] {
  const currentOrigin = location.origin;
  const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((link) => {
    if (!isVisible(link)) return [];
    let url: URL;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return [];
    }
    if (url.origin !== currentOrigin || !/^https?:$/.test(url.protocol)) return [];
    const text = normalizeText([link.textContent, link.title, link.getAttribute('aria-label')].filter(Boolean).join(' '));
    const filename = decodeURIComponent(url.pathname.split('/').pop() || '');
    const looksLikeFile = Boolean(link.download)
      || /\.(?:pdf|png|jpe?g|webp|docx?|xlsx?)(?:$|[?#])/i.test(url.href)
      || /下载|预览|查看|附件|材料|证明|证书|成绩单|申请表/i.test(`${text} ${filename}`);
    if (!looksLikeFile) return [];
    return [{
      url: url.href,
      filename: link.download || filename || text,
      label: text || filename || '网站材料',
    }];
  });
  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
}

function getAuditPageSnapshot() {
  const meta = getPageMeta();
  return {
    ...meta,
    fields: scanFields().filter((result) => !isSensitiveAuditField(result.field)),
    websiteMaterials: discoverVisibleWebsiteMaterials(),
  };
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
    )).filter((candidate) => isVisible(candidate) && !(candidate as HTMLButtonElement).disabled);
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .filter((candidate) => isVisible(candidate) && candidate.type !== 'hidden' && candidate.type !== 'button');
    const distance = (left: HTMLElement, right: HTMLElement): number => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const leftX = leftRect.left + leftRect.width / 2;
      const leftY = leftRect.top + leftRect.height / 2;
      const rightX = rightRect.left + rightRect.width / 2;
      const rightY = rightRect.top + rightRect.height / 2;
      return Math.round(Math.hypot(leftX - rightX, leftY - rightY));
    };
    const candidates = controls.map((candidate, index) => {
      const nearestInput = inputs
        .map((input) => ({ input, distance: distance(input, candidate) }))
        .sort((left, right) => left.distance - right.distance)[0];
      return {
        id: String(index),
        ownerId: nearestInput?.input === el ? 'target' : 'other',
        distance: nearestInput?.distance ?? Number.MAX_SAFE_INTEGER,
        label: normalizeText((candidate as HTMLInputElement).value || candidate.textContent || ''),
      };
    });
    const selected = selectScopedTrigger(candidates, 'target');
    if (selected != null) return controls[Number(selected)] ?? null;
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
    ['科研训练', /科研训练|科研项目|研究项目/],
    ['实习实践', /实习实践|实习经历|实践经历/],
    ['社会工作', /社会工作|学生工作|社会职务/],
    ['已发表论文', /已发表论文|论文情况|论文成果|发表论文/],
    ['已取得专利', /已取得专利|专利情况|专利成果/],
    ['学科竞赛', /学科竞赛|专业竞赛|竞赛成果|竞赛经历|比赛经历/],
    ['本科期间校级以上（含）荣誉奖励', /本科期间.*荣誉奖励|校级以上.*荣誉|荣誉奖励/],
    ['项目经历', /项目经历|项目经验|科研实践/],
    ['论文情况', /论文情况|论文成果/],
    ['获奖情况', /获奖情况|奖励情况|奖惩情况|获奖经历/],
    ['学习和工作经历', /学习.{0,3}工作经历|教育经历|工作经历|学习经历/],
    ['学术成果', /学术成果|科研成果|论文|专利|著作/],
    ['奖励情况', /奖励|获奖|荣誉|奖惩/],
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
    return '获奖情况';
  }
  if (/论文/.test(headerText) && /(名称|标题|类型|时间|排序|发表)/.test(headerText)) {
    return '论文情况';
  }
  if (/专利/.test(headerText) && /(名称|标题|类型|时间|授权|受理)/.test(headerText)) {
    return '已取得专利';
  }
  if (/(项目|实践|工作)/.test(headerText) && /(描述|时间|期间|角色|单位|名称)/.test(headerText)) {
    return '项目经历';
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
  const repeatProfileGroups = new Set([
    '家庭成员', '外语水平', '学习和工作经历', '学术成果', '奖励情况',
    '科研训练', '实习实践', '社会工作', '已发表论文', '已取得专利',
    '学科竞赛', '本科期间校级以上（含）荣誉奖励', '项目经历', '论文情况', '获奖情况',
  ]);

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
  return Array.from(document.querySelectorAll<HTMLTableElement>('table')).find((table) => {
    const localHeading = findNearestHeadingText(table);
    const detectedGroup = inferProfileGroupFromTable(table) || detectProfileGroup(joinUnique([
      normalizeText(table.caption?.textContent ?? ''),
      localHeading,
    ]));
    return detectedGroup === groupLabel;
  });
}

function findAddRowControl(table: HTMLTableElement): HTMLElement | undefined {
  let container: HTMLElement | null = table.parentElement;
  for (let depth = 0; container && container !== document.body && depth < 5; depth++, container = container.parentElement) {
    const control = Array.from(container.querySelectorAll<HTMLElement>('button,a,[role="button"],span')).find((candidate) => {
      if (!isVisible(candidate) || (candidate as HTMLButtonElement).disabled) return false;
      const candidateTable = candidate.closest<HTMLTableElement>('table');
      if (candidateTable && candidateTable !== table) return false;
      if (!candidateTable) {
        const precedingTable = Array.from(document.querySelectorAll<HTMLTableElement>('table'))
          .filter((candidateTable) => Boolean(
            candidateTable.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING,
          ))
          .at(-1);
        if (precedingTable !== table) return false;
      }
      if (candidate instanceof HTMLSpanElement) {
        const style = (candidate.ownerDocument.defaultView ?? window).getComputedStyle(candidate);
        const clickable = candidate.getAttribute('role') === 'button'
          || candidate.hasAttribute('onclick')
          || candidate.tabIndex >= 0
          || style.cursor === 'pointer';
        if (!clickable) return false;
      }
      const visibleText = normalizeText(candidate.textContent ?? '').replace(/\s+/g, '');
      const accessibleLabel = normalizeText([
        candidate.getAttribute('aria-label') ?? '',
        candidate.getAttribute('title') ?? '',
      ].join(' ')).replace(/\s+/g, '').toLowerCase();
      if (
        isAddRowLabel(visibleText)
        || isAddRowLabel(accessibleLabel)
      ) return true;
      return false;
    });
    if (control) return control;
  }
  return undefined;
}

async function waitForRowOrRepeatDialog(
  table: HTMLTableElement,
  previousCount: number,
  groupLabel: string,
  beforeRoots: ReadonlySet<HTMLElement>,
): Promise<'row' | 'dialog' | 'ambiguous-dialog' | 'none'> {
  for (let attempt = 0; attempt < 16; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 75));
    if (repeatDataRows(table).length > previousCount) return 'row';
    const dialog = findUniqueRepeatDialogRoot(groupLabel, beforeRoots);
    if (dialog.root) return 'dialog';
    if (dialog.reason === 'ambiguous-dialog-root') return 'ambiguous-dialog';
  }
  return 'none';
}

async function prepareRepeatRows(
  targets: PrepareRepeatRowsMessage['targets'],
): Promise<PrepareRepeatRowsResult> {
  let added = 0;
  const failures: PrepareRepeatRowsResult['failures'] = [];
  const dialogGroups = new Set<string>();
  for (const target of targets) {
    const table = findRepeatTable(target.groupLabel);
    if (!table) {
      if (classifyRepeatPreparation({ tableMatch: 'none', hasAddControl: false }) === 'skip') continue;
      continue;
    }
    const requestedRows = Math.max(Math.floor(target.requiredRows), 0);
    const safeTarget = Math.min(requestedRows, 10);
    if (requestedRows > safeTarget) {
      failures.push({ groupLabel: target.groupLabel, reason: 'Requested row count exceeds the safe limit of 10' });
    }
    while (repeatDataRows(table).length < safeTarget) {
      const previousCount = repeatDataRows(table).length;
      const control = findAddRowControl(table);
      if (!control) {
        if (classifyRepeatPreparation({ tableMatch: 'strong', hasAddControl: false }) === 'failure') {
          failures.push({ groupLabel: target.groupLabel, reason: 'No visible add-row control found' });
        }
        break;
      }
      try {
        const beforeRoots = new Set(getVisibleDialogRoots());
        control.click();
        const outcome = await waitForRowOrRepeatDialog(table, previousCount, target.groupLabel, beforeRoots);
        if (outcome === 'dialog') {
          dialogGroups.add(target.groupLabel);
          break;
        }
        if (outcome === 'ambiguous-dialog') {
          failures.push({ groupLabel: target.groupLabel, reason: 'Add-row control opened multiple matching record dialogs or drawers' });
          break;
        }
        if (outcome !== 'row') {
          failures.push({ groupLabel: target.groupLabel, reason: 'Add-row control did not create a field row' });
          break;
        }
      } catch {
        failures.push({ groupLabel: target.groupLabel, reason: 'Add-row control click failed' });
        break;
      }
      added++;
    }
  }
  return { added, failures, dialogGroups: [...dialogGroups] };
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

function collectVisibleDialogRoots(): HTMLElement[] {
  const roots = Array.from(document.querySelectorAll<HTMLElement>(
    '[role="dialog"],.modal,.dialog,.popup,.drawer,.layui-layer,.ui-dialog,.el-dialog,.el-drawer,.ant-modal,.ant-drawer,.ivu-drawer,.vxe-modal,.window',
  )).filter(isVisible);
  for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).filter(isVisible)) {
    try {
      const body = frame.contentDocument?.body;
      if (body) roots.push(body);
    } catch {
      // Cross-origin dialog frames cannot be automated safely.
    }
  }
  return roots;
}

function getVisibleDialogRoots(): HTMLElement[] {
  const roots = collectVisibleDialogRoots();
  return roots.length ? roots : [document.body];
}

function sameRepeatGroupLabel(left: string, right: string): boolean {
  const normalizedLeft = normalizeText(left).replace(/\s+/g, '');
  const normalizedRight = normalizeText(right).replace(/\s+/g, '');
  return Boolean(normalizedLeft && normalizedRight && (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ));
}

function visibleControlLabel(control: HTMLElement): string {
  return normalizeText([
    (control as HTMLInputElement).value ?? '',
    control.textContent ?? '',
    control.getAttribute('aria-label') ?? '',
    control.getAttribute('title') ?? '',
  ].join(' '));
}

const REPEAT_DIALOG_ROOT_SELECTOR = '[role="dialog"],.modal,.dialog,.popup,.drawer,.layui-layer,.ui-dialog,.el-dialog,.el-drawer,.ant-modal,.ant-drawer,.ivu-drawer,.vxe-modal,.window';
const REPEAT_DIALOG_TITLE_SELECTOR = '[role="heading"],.modal-title,.dialog-title,.el-dialog__title,.ant-modal-title,.drawer-title,.el-drawer__title,.ant-drawer-title,.layui-layer-title,.ui-dialog-title';
const REPEAT_DIALOG_FOOTER_SELECTOR = 'footer,.modal-footer,.dialog-footer,.el-dialog__footer,.ant-modal-footer,.drawer-footer,.el-drawer__footer,.ant-drawer-footer,.layui-layer-btn,.ui-dialog-buttonpane';

type RepeatDialogRootReason = 'dialog-root' | 'no-dialog-root' | 'no-new-dialog-root' | 'ambiguous-dialog-root';

interface RepeatDialogRootResult {
  root?: HTMLElement;
  reason: RepeatDialogRootReason;
}

function repeatDialogTitleText(root: HTMLElement): string {
  const labelledBy = root.getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => root.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ') ?? '';
  const titles = Array.from(root.querySelectorAll<HTMLElement>(REPEAT_DIALOG_TITLE_SELECTOR))
    .filter(isVisible)
    .filter((title) => {
      const closestRoot = title.closest<HTMLElement>(REPEAT_DIALOG_ROOT_SELECTOR);
      return !closestRoot || closestRoot === root;
    })
    .map((title) => normalizeText(title.textContent ?? ''));
  return joinUnique([
    root.getAttribute('aria-label') ?? '',
    labelledBy,
    ...titles,
  ]);
}

function isGenericRepeatDialogTitle(value: string): boolean {
  const normalized = normalizeText(value).replace(/\s+/g, '').toLowerCase();
  return !normalized || /^(?:新增|添加|新建|录入|add|create|new)$/.test(normalized);
}

function findUniqueRepeatDialogRoot(
  groupLabel: string,
  beforeRoots?: ReadonlySet<HTMLElement>,
): RepeatDialogRootResult {
  const roots = getVisibleDialogRoots()
    .filter((root) => root !== document.body && isVisible(root))
    .filter((root) => countEditables(root) >= 1);
  const selection = selectRepeatDialogRoot(roots.map((root) => {
    const title = repeatDialogTitleText(root);
    const contentGroup = detectProfileGroup(textWithoutControls(root));
    return {
      id: root,
      newlyOpened: !beforeRoots || !beforeRoots.has(root),
      leaf: !roots.some((other) => other !== root && root.contains(other)),
      groupMatched: (
        sameRepeatGroupLabel(detectProfileGroup(title), groupLabel) ||
        sameRepeatGroupLabel(title, groupLabel) ||
        (isGenericRepeatDialogTitle(title) && sameRepeatGroupLabel(contentGroup, groupLabel))
      ),
    };
  }), Boolean(beforeRoots));
  return { root: selection.id, reason: selection.reason };
}

async function waitForRepeatDialogRoot(
  groupLabel: string,
  timeoutMs = 1600,
  beforeRoots?: ReadonlySet<HTMLElement>,
): Promise<RepeatDialogRootResult> {
  const deadline = Date.now() + timeoutMs;
  let latest: RepeatDialogRootResult = {
    reason: beforeRoots ? 'no-new-dialog-root' : 'no-dialog-root',
  };
  while (Date.now() < deadline) {
    const result = findUniqueRepeatDialogRoot(groupLabel, beforeRoots);
    if (result.root || result.reason === 'ambiguous-dialog-root') return result;
    latest = result;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return latest;
}

function captureRepeatGroupSnapshot(groupLabel: string): { recordCount: number; text: string } {
  const table = findRepeatTable(groupLabel);
  if (!table) return { recordCount: 0, text: '' };
  return {
    recordCount: repeatDataRows(table).length,
    text: textWithoutControls(table),
  };
}

interface RepeatDialogEntry {
  index: number;
  el: HTMLElement;
  field: FormField;
}

function collectRepeatDialogEntries(root: HTMLElement): RepeatDialogEntry[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR))
    .filter(isFillable)
    .map((el, index) => ({ index, el, field: extractField(el) }));
}

function findUnsafeRepeatDialogControl(root: HTMLElement): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('button,a,input[type="button"],input[type="submit"],[role="button"]'))
    .find((control) => isVisible(control) && isProtectedRepeatDialogControl(visibleControlLabel(control)));
}

function isRecordAssociatedRepeatDialogSaveControl(root: HTMLElement, control: HTMLElement): boolean {
  const form = control.closest('form');
  if (form && root.contains(form)) return true;
  const footer = control.closest<HTMLElement>(REPEAT_DIALOG_FOOTER_SELECTOR);
  return Boolean(footer && root.contains(footer));
}

function findSafeRepeatDialogSaveControl(
  root: HTMLElement,
): { control?: HTMLElement; reason: 'record-save' | 'ambiguous-record-save' | 'no-record-save' } {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('button,a,input[type="button"],input[type="submit"],[role="button"]'))
    .filter((control) => isVisible(control) && !(control as HTMLButtonElement).disabled)
    .map((control) => ({
      id: control,
      label: visibleControlLabel(control),
      recordAssociated: isRecordAssociatedRepeatDialogSaveControl(root, control),
    }));
  const selection = selectRepeatDialogSaveCandidate(candidates);
  return {
    control: selection.id,
    reason: selection.reason,
  };
}

async function fillRepeatDialogRecord(
  root: HTMLElement,
  fields: Array<{ key: string; value: string }>,
): Promise<{ processedFields: number; assignedValues: string[]; reason?: string }> {
  const entries = collectRepeatDialogEntries(root);
  if (entries.length === 0) return { processedFields: 0, assignedValues: [], reason: 'No editable record fields found in dialog' };
  if (findUnsafeRepeatDialogControl(root)) {
    return { processedFields: 0, assignedValues: [], reason: 'Dialog contains a protected high-risk control' };
  }
  const classified = classifyRepeatDialogFields(entries.map((entry) => ({
    index: entry.index,
    label: joinUnique([entry.field.columnLabel, entry.field.label, entry.field.hint, entry.field.context]),
    value: entry.field.value,
    required: entry.field.required,
    kind: entry.field.kind,
    protected: entry.field.protected,
  })));
  const plan = planRepeatDialogAssignments(classified, fields);
  if (plan.failures.length > 0) {
    return { processedFields: 0, assignedValues: [], reason: `Required dialog fields cannot be safely matched (${plan.failures[0].code})` };
  }
  const entryByIndex = new Map(entries.map((entry) => [entry.index, entry]));
  let processedFields = 0;
  for (const assignment of plan.assignments) {
    const entry = entryByIndex.get(assignment.index);
    if (!entry || !await fillElementAsync(entry.el, assignment.value, 'high')) {
      return { processedFields, assignedValues: [], reason: 'Dialog field could not be filled and read back' };
    }
    processedFields++;
  }
  for (const entry of entries) {
    if (!entry.field.required) continue;
    if (entry.field.protected || entry.field.kind === 'file' || !getCurrentValue(entry.el).trim()) {
      return { processedFields, assignedValues: [], reason: 'A required dialog field remains unverified' };
    }
  }
  return { processedFields, assignedValues: plan.assignments.map((assignment) => assignment.value) };
}

function isRepeatDialogReadyForNextRecord(root: HTMLElement, assignedValues: string[]): boolean {
  const assigned = assignedValues.map((value) => normalizeText(value)).filter(Boolean);
  if (assigned.length === 0) return false;
  return assigned.every((value) => collectRepeatDialogEntries(root)
    .every((entry) => normalizeText(getCurrentValue(entry.el)) !== value));
}

type RepeatDialogSaveVerification = 'dialog-closed' | 'record-changed' | 'unverified';

async function waitForRepeatDialogSave(
  root: HTMLElement,
  groupLabel: string,
  beforeSnapshot: { recordCount: number; text: string },
  assignedValues: string[],
): Promise<RepeatDialogSaveVerification> {
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!root.isConnected || !isVisible(root)) return 'dialog-closed';
    if (hasVerifiedRepeatRecordChange(
      beforeSnapshot,
      captureRepeatGroupSnapshot(groupLabel),
      assignedValues,
    )) return 'record-changed';
  }
  return 'unverified';
}

async function prepareRepeatRecords(
  targets: PrepareRepeatRecordsMessage['targets'],
): Promise<PrepareRepeatRecordsResult> {
  let added = 0;
  let processed = 0;
  const failures: PrepareRepeatRecordsResult['failures'] = [];
  for (const target of targets) {
    const safeRecords = target.records.slice(0, 10);
    if (target.records.length > safeRecords.length) {
      failures.push({ groupLabel: target.groupLabel, presentation: 'dialog', reason: 'Requested record count exceeds the safe limit of 10' });
    }
    for (const record of safeRecords) {
      const table = findRepeatTable(target.groupLabel);
      if (!table) {
        failures.push({ groupLabel: target.groupLabel, itemIndex: record.itemIndex, presentation: 'dialog', reason: 'Repeatable group table not found' });
        break;
      }
      let dialog = await waitForRepeatDialogRoot(target.groupLabel, 300);
      let root = dialog.root;
      if (!root) {
        if (dialog.reason === 'ambiguous-dialog-root') {
          failures.push({ groupLabel: target.groupLabel, itemIndex: record.itemIndex, presentation: 'dialog', reason: 'Multiple matching record dialogs or drawers are open' });
          break;
        }
        const control = findAddRowControl(table);
        if (!control) {
          failures.push({ groupLabel: target.groupLabel, itemIndex: record.itemIndex, presentation: 'dialog', reason: 'No visible add-record control found' });
          break;
        }
        try {
          const beforeRoots = new Set(getVisibleDialogRoots());
          control.click();
          dialog = await waitForRepeatDialogRoot(target.groupLabel, 1600, beforeRoots);
          root = dialog.root;
        } catch {
          failures.push({ groupLabel: target.groupLabel, itemIndex: record.itemIndex, presentation: 'dialog', reason: 'Add-record control click failed' });
          break;
        }
      }
      if (!root) {
        failures.push({
          groupLabel: target.groupLabel,
          itemIndex: record.itemIndex,
          presentation: 'dialog',
          reason: dialog.reason === 'ambiguous-dialog-root'
            ? 'Add-record control opened multiple matching record dialogs or drawers'
            : 'Add-record control did not open one unique matching dialog or drawer',
        });
        break;
      }
      const beforeSnapshot = captureRepeatGroupSnapshot(target.groupLabel);
      const fillResult = await fillRepeatDialogRecord(root, record.fields);
      if (fillResult.reason) {
        failures.push({ groupLabel: target.groupLabel, itemIndex: record.itemIndex, presentation: 'dialog', reason: fillResult.reason });
        break;
      }
      const save = findSafeRepeatDialogSaveControl(root);
      if (!save.control) {
        failures.push({
          groupLabel: target.groupLabel,
          itemIndex: record.itemIndex,
          presentation: 'dialog',
          reason: save.reason === 'ambiguous-record-save'
            ? 'Multiple record-level save controls are open; unable to choose safely'
            : 'No safe record-level save control found in dialog',
        });
        break;
      }
      try {
        save.control.click();
      } catch {
        failures.push({ groupLabel: target.groupLabel, itemIndex: record.itemIndex, presentation: 'dialog', reason: 'Record-level save control click failed' });
        break;
      }
      const verification = await waitForRepeatDialogSave(
        root,
        target.groupLabel,
        beforeSnapshot,
        fillResult.assignedValues,
      );
      if (verification === 'unverified') {
        failures.push({ groupLabel: target.groupLabel, itemIndex: record.itemIndex, presentation: 'dialog', reason: 'Record save could not be verified; dialog remains open' });
        break;
      }
      added++;
      processed += fillResult.processedFields;
      if (verification === 'record-changed' && !isRepeatDialogReadyForNextRecord(root, fillResult.assignedValues)) {
        failures.push({ groupLabel: target.groupLabel, itemIndex: record.itemIndex, presentation: 'dialog', reason: 'Record was saved but the editor remains populated; paused before the next record to avoid overwriting it' });
        break;
      }
    }
  }
  return { added, processed, failures };
}

function normalizeSelectionText(text: string): string {
  return normalizeText(text).trim();
}

async function waitForDialogChoice(root: HTMLElement, value: string, timeoutMs = 2500): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  const wanted = normalizeSelectionText(value);
  const comparable = (text: string) => normalizeSelectionText(text).replace(/^\d{4,12}\s*/, '');
  while (Date.now() < deadline) {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(
      '[role="option"],li,td,a,button,.option,.item,.tree-node,.el-tree-node__label,.ant-select-item-option-content',
    )).filter((candidate) => isVisible(candidate) && candidate.childElementCount <= 3);
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

async function searchDialogChoice(root: HTMLElement, value: string): Promise<HTMLElement | null> {
  const term = getTerminalSelectionTerm(value);
  if (!term) return null;
  const input = Array.from(root.querySelectorAll<HTMLInputElement>(
    'input[type="search"],input[type="text"],input:not([type])',
  )).find((candidate) => isVisible(candidate) && !candidate.disabled && !candidate.readOnly);
  if (!input) return null;
  const button = Array.from(root.querySelectorAll<HTMLElement>('button,a,input[type="button"],[role="button"]'))
    .find((candidate) => isVisible(candidate) && /^(搜索|查询|查找)$/.test(normalizeText(
      (candidate as HTMLInputElement).value || candidate.textContent || '',
    )));
  if (!button) return null;
  setDialogSearchValue(input, term);
  button.click();
  return waitForDialogChoice(root, term, 1800);
}

function dialogValueMatches(el: HTMLElement, expected: string): boolean {
  if (valueMatches(el, expected)) return true;
  const actual = normalizeSelectionText(getCurrentValue(el)).replace(/^\d{4,12}/, '').replace(/[|/>\\,，;；\s-]+/g, '');
  const wanted = normalizeSelectionText(expected).replace(/^\d{4,12}/, '').replace(/[|/>\\,，;；\s-]+/g, '');
  return Boolean(actual && wanted && (actual.includes(wanted) || wanted.includes(actual)));
}

function selectionFieldKeyword(fieldText: string): string {
  if (/院系|学院|系所/.test(fieldText)) return '院系';
  if (/专业/.test(fieldText)) return '专业';
  if (/学校|院校/.test(fieldText)) return '学校';
  return '';
}

async function waitForSelectionDialogRoot(
  fieldText: string,
  beforeRoots: ReadonlySet<HTMLElement>,
  timeoutMs = 1800,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  const keyword = selectionFieldKeyword(fieldText);
  while (Date.now() < deadline) {
    const roots = collectVisibleDialogRoots();
    const newlyOpened = roots.filter((root) => !beforeRoots.has(root));
    const candidates = roots.map((root, index) => {
      const rootText = normalizeText([
        repeatDialogTitleText(root),
        root.getAttribute('aria-label') ?? '',
      ].join(' '));
      return {
        id: String(index),
        wasVisibleBefore: beforeRoots.has(root),
        associated: newlyOpened.length === 1 || !keyword || rootText.includes(keyword),
      };
    });
    const selected = selectNewDialogRoot(candidates);
    if (selected != null) return roots[Number(selected)] ?? null;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

function findScopedSelectionConfirm(root: HTMLElement): HTMLElement | null {
  const controls = Array.from(root.querySelectorAll<HTMLElement>(
    'button,a,input[type="button"],input[type="submit"],[role="button"]',
  )).filter((candidate) => isVisible(candidate) && !(candidate as HTMLButtonElement).disabled);
  const selected = selectScopedConfirm(controls.map((control, index) => ({
    id: String(index),
    dialogId: 'target-dialog',
    label: normalizeText((control as HTMLInputElement).value || control.textContent || ''),
  })), 'target-dialog');
  return selected == null ? null : controls[Number(selected)] ?? null;
}

async function waitForDialogValue(el: HTMLElement, value: string, timeoutMs = 1400): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dialogValueMatches(el, value)) return true;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return dialogValueMatches(el, value);
}

async function fillDialogSelection(
  el: HTMLElement,
  value: string,
  confidence: 'high' | 'medium' | 'low',
): Promise<boolean> {
  const trigger = findSelectionTrigger(el);
  if (!trigger) return false;
  const field = extractField(el);
  const fieldText = joinUnique([field.label, field.hint, field.context, field.ariaLabel, field.title]);
  const beforeRoots = new Set(collectVisibleDialogRoots());
  trigger.click();
  const dialogRoot = await waitForSelectionDialogRoot(fieldText, beforeRoots);
  if (!dialogRoot) {
    markField(el, 'review');
    return false;
  }
  let choice = await waitForDialogChoice(dialogRoot, value, 1200);

  if (!choice) {
    choice = await searchDialogChoice(dialogRoot, value);
  }

  if (!choice) {
    const search = Array.from(dialogRoot.querySelectorAll<HTMLInputElement>(
      'input[type="text"],input:not([type])',
    )).find((input) => input !== el && isVisible(input) && !input.readOnly && !input.disabled);
    if (search) {
      const view = search.ownerDocument.defaultView;
      const setter = view?.HTMLInputElement && Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(search, value); else search.value = value;
      const EventConstructor = view?.Event ?? Event;
      search.dispatchEvent(new EventConstructor('input', { bubbles: true }));
      search.dispatchEvent(new EventConstructor('change', { bubbles: true }));
      choice = await waitForDialogChoice(dialogRoot, value, 1800);
    }
  }

  if (!choice) {
    markField(el, 'review');
    return false;
  }
  choice.click();
  await waitForDialogValue(el, value, 500);

  if (!dialogValueMatches(el, value)) {
    const confirm = findScopedSelectionConfirm(dialogRoot);
    confirm?.click();
    await waitForDialogValue(el, value);
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
        } else if (message.type === 'getAuditPageSnapshot') {
          sendResponse(getAuditPageSnapshot());
        } else if (message.type === 'prepareRepeatRows') {
          prepareRepeatRows(message.targets)
            .then(sendResponse)
            .catch(() => sendResponse({
              added: 0,
              failures: message.targets.map((target) => ({
                groupLabel: target.groupLabel,
                reason: 'Unexpected repeatable row preparation failure',
              })),
            }));
        } else if (message.type === 'prepareRepeatRecords') {
          prepareRepeatRecords(message.targets)
            .then(sendResponse)
            .catch(() => sendResponse({
              added: 0,
              processed: 0,
              failures: message.targets.map((target) => ({
                groupLabel: target.groupLabel,
                presentation: 'dialog' as const,
                reason: 'Unexpected repeatable dialog preparation failure',
              })),
            }));
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
