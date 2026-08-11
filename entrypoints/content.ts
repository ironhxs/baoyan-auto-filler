import { fieldFingerprint } from '@/utils/field-fingerprint';
import { isSensitiveAuditField } from '@/utils/final-audit';
import type { WebsiteMaterialCandidate } from '@/utils/final-audit';
import { isSafePreviousStepLabel, waitForPageTransition } from '@/utils/navigation-wait';
import { inferImageMimeType } from '@/utils/image-mime';
import { chooseNearestAncestorQuestionContext } from '@/utils/field-context';
import { stableTargetId } from '@/utils/agent/page-snapshot';
import type { AgentExecutionItem, AgentExecutionResult } from '@/utils/agent/executor';
import type { AgentPageSemanticContext } from '@/utils/agent/types';
import {
  buildAgentPageSemanticText,
  isSensitiveAgentPageText,
  normalizeAgentPageText,
} from '@/utils/agent/page-context';
import { classifyObservedRepeatTable, extractAgentFieldRules } from '@/utils/agent/field-rules';
import {
  MAX_REPEAT_ROW_ADDITIONS_PER_PASS,
  forEachRepeatPreparationTarget,
  isAddRowLabel,
  limitRepeatRecordBatch,
  planRepeatRowPreparation,
  type CommitRepeatRecordResult,
  type RepeatableGroupObservation,
} from '@/utils/repeatable-records';
import {
  classifyRepeatableHeaderSchema,
  classifyRepeatPreparation,
  selectNewDialogRoot,
  selectScopedConfirm,
  selectScopedTrigger,
} from '@/utils/dom-selection-policy';
import {
  classifyRepeatDialogFields,
  hasVerifiedRepeatRecordChange,
  isProtectedRepeatDialogControl,
  pickRepeatDialogFieldLabel,
  planRepeatDialogAssignments,
  selectRepeatDialogCancelCandidate,
  selectRepeatDialogRoot,
  selectRepeatDialogSaveCandidate,
  validateRepeatDialogCommit,
} from '@/utils/repeatable-dialog';
import {
  selectAdjacentRepeatGroupSurface,
  type RepeatGroupSurfaceNode,
} from '@/utils/repeat-group-surface';
import {
  classifyDomControl,
  collectDisplayValueCandidates,
  createDomControlInteractionPlan,
  datePickerValuesEquivalent,
  getCascaderNodeActivationSelectors,
  getOverlayRootSelectors,
  isActionableOverlayCandidate,
  isActionableOverlaySurface,
  parseDatePickerTarget,
  pickCascaderExplorationLabels,
  pickControlIdentityCandidate,
  pickHierarchicalSegment,
  selectionTextsEquivalent,
  type DomControlKind,
  type DomControlIdentity,
  type DomControlProbe,
} from '@/utils/dom-control-adapter';
import {
  alignRepeatableQuestionCell,
  findRepeatableQuestionCell,
  restoreRepeatableQuestionCell,
} from '@/utils/marker-layout';

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
  maxLength?: number;
  forbiddenCharacters?: string[];
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
interface ObserveRepeatGroupsMessage { type: 'observeRepeatGroups' }
interface CommitRepeatRecordMessage { type: 'commitRepeatRecord'; groupLabel: string }
interface GetAgentPageContextMessage { type: 'getAgentPageContext' }
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
  blocked?: boolean;
  dismissedGroups?: string[];
  failures: Array<{
    groupLabel: string;
    itemIndex?: number;
    presentation: 'inline' | 'dialog';
    reason: string;
  }>;
}
interface AdvanceToNextStepMessage { type: 'advanceToNextStep' }
interface ReturnToPreviousStepMessage { type: 'returnToPreviousStep' }
interface MarkPreviewMessage {
  type: 'markPreview';
  items: Array<{ index: number; fingerprint?: string; status: 'verified' | 'review' | 'mismatch'; message?: string }>;
}
interface FocusFieldMessage { type: 'focusField'; index: number }
interface FocusAgentTargetMessage { type: 'focusAgentTarget'; pageKey: string; targetId: string }
interface GetExistingMaterialPreviewMessage { type: 'getExistingMaterialPreview'; index: number }
interface GetPageMetaMessage { type: 'getPageMeta' }
interface GetAuditPageSnapshotMessage { type: 'getAuditPageSnapshot' }
interface ExecuteAgentActionsMessage {
  type: 'executeAgentActions';
  pageKey: string;
  items: AgentExecutionItem[];
}
type Message = ScanMessage | ObserveRepeatGroupsMessage | CommitRepeatRecordMessage | GetAgentPageContextMessage | FillMessage | FillStreamInitMessage | FillFieldMessage | FillTypeChunkMessage | FillTypeCommitMessage | FillStreamCompleteMessage | ManualFillMessage | PrepareRepeatRowsMessage | PrepareRepeatRecordsMessage | AdvanceToNextStepMessage | ReturnToPreviousStepMessage | MarkPreviewMessage | FocusFieldMessage | FocusAgentTargetMessage | GetExistingMaterialPreviewMessage | GetPageMetaMessage | GetAuditPageSnapshotMessage | ExecuteAgentActionsMessage;

let elementMap = new Map<number, HTMLElement>();
let protectedIndices = new Set<number>();
let lastFocusedElement: HTMLElement | null = null;
let lastCascaderTrace: string[] = [];

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
const CUSTOM_CONTROL_SELECTOR = [
  '.res-select',
  '.res-cascader',
  '.res-date-picker',
  '.el-select',
  '.el-cascader',
  '.el-date-editor',
  '[role="combobox"]',
  '[aria-haspopup="listbox"]',
].join(',');
const EPHEMERAL_OVERLAY_SELECTOR = [
  ...getOverlayRootSelectors('select'),
  ...getOverlayRootSelectors('cascader'),
  ...getOverlayRootSelectors('date-picker'),
].join(',');

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getCustomControlOwner(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>(CUSTOM_CONTROL_SELECTOR);
}

function getControlAttribute(el: HTMLElement, name: string): string {
  const direct = el.getAttribute(name);
  if (direct) return direct;
  let ancestor: HTMLElement | null = el.parentElement;
  for (let depth = 0; ancestor && ancestor !== document.body && depth < 6; depth++, ancestor = ancestor.parentElement) {
    const value = ancestor.getAttribute(name);
    if (value) return value;
  }
  return '';
}

function domControlIdentity(el: HTMLElement): DomControlIdentity {
  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || undefined,
    name: getControlAttribute(el, 'name') || undefined,
    prop: getControlAttribute(el, 'prop') || undefined,
    type: el instanceof HTMLInputElement ? el.type : undefined,
  };
}

function resolveLiveControl(el: HTMLElement): HTMLElement {
  if (el.isConnected) return el;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR));
  const selectedIndex = pickControlIdentityCandidate(
    domControlIdentity(el),
    candidates.map(domControlIdentity),
  );
  return selectedIndex == null ? el : candidates[selectedIndex] ?? el;
}

function buildDomControlProbe(el: HTMLElement): DomControlProbe {
  const owner = getCustomControlOwner(el);
  const ancestorClassNames: string[] = [];
  let ancestor: HTMLElement | null = el.parentElement;
  for (let depth = 0; ancestor && ancestor !== document.body && depth < 6; depth++, ancestor = ancestor.parentElement) {
    if (typeof ancestor.className === 'string' && ancestor.className.trim()) {
      ancestorClassNames.push(ancestor.className);
    }
  }
  const attributes = Object.fromEntries([
    'xtype',
    'name',
    'prop',
    'caption',
    'label',
    'format',
    'pattern',
    'value-format',
    'appendtobody',
    'aria-haspopup',
    'aria-controls',
    'aria-owns',
  ].map((name) => [name, getControlAttribute(el, name) || undefined]));
  const selected = owner?.querySelector<HTMLElement>([
    '.el-select-selection-item',
    '.el-select__selected-item',
    '.el-select__tags-text',
    '.ant-select-selection-item',
    '.el-cascader__label',
    '[aria-selected="true"]',
  ].join(','));
  return {
    tagName: el.tagName.toLowerCase(),
    type: el instanceof HTMLInputElement ? el.type : undefined,
    value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : undefined,
    placeholder: el.getAttribute('placeholder') ?? undefined,
    readOnly: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.readOnly : undefined,
    disabled: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.disabled
      : undefined,
    role: el.getAttribute('role') ?? undefined,
    classNames: typeof el.className === 'string' ? [el.className] : [],
    ancestorClassNames,
    attributes,
    labelText: getControlAttribute(el, 'label') || getControlAttribute(el, 'caption') || findLabel(el),
    visibleSelectionText: selected ? normalizeText(selected.textContent ?? '') : undefined,
    visibleDisplayText: owner?.getAttribute('aria-valuetext') ?? undefined,
  };
}

function controlKind(el: HTMLElement): DomControlKind {
  return classifyDomControl(buildDomControlProbe(el));
}

function isInsideEphemeralOverlay(el: HTMLElement): boolean {
  return Boolean(EPHEMERAL_OVERLAY_SELECTOR && el.closest(EPHEMERAL_OVERLAY_SELECTOR));
}

function isVisible(el: HTMLElement): boolean {
  const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

const ACTIONABLE_OVERLAY_CANDIDATE_SELECTOR = [
  '[role="option"]',
  '[role="menuitem"]',
  '.el-select-dropdown__item',
  '.el-cascader-node',
  '.el-date-table td',
  '.el-month-table td',
  '.el-year-table td',
  '.ant-select-item-option',
  '.ant-cascader-menu-item',
  '.ant-picker-cell',
].join(',');

function buildOverlaySurfaceProbe(el: HTMLElement) {
  const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    width: rect.width,
    height: rect.height,
    className: typeof el.className === 'string' ? el.className : '',
    candidateCount: el.querySelectorAll(ACTIONABLE_OVERLAY_CANDIDATE_SELECTOR).length,
  };
}

function isActionableOverlayRoot(el: HTMLElement): boolean {
  return isActionableOverlaySurface(buildOverlaySurfaceProbe(el));
}

function isActionableOverlayChoice(root: HTMLElement, candidate: HTMLElement): boolean {
  return isActionableOverlayCandidate(
    buildOverlaySurfaceProbe(root),
    buildOverlaySurfaceProbe(candidate),
  );
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
  if (
    el instanceof HTMLInputElement
    && !el.disabled
    && (controlKind(el) === 'select' || controlKind(el) === 'cascader')
  ) {
    const owner = getCustomControlOwner(el);
    if (owner && isVisible(el)) return el;
    const visibleInput = owner && Array.from(owner.querySelectorAll<HTMLInputElement>('input'))
      .find((candidate) => isVisible(candidate) && !candidate.disabled);
    if (visibleInput) return visibleInput;
  }

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
  const kind = controlKind(el);
  if (kind === 'date-picker') return false;
  return Boolean(findSelectionTrigger(el));
}

function isSupportedDatePicker(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || el.disabled) return false;
  return controlKind(el) === 'date-picker';
}

function findDatePickerTrigger(el: HTMLInputElement): HTMLElement {
  const owner = getCustomControlOwner(el);
  const candidates = [
    owner?.querySelector<HTMLElement>('.el-icon-date'),
    owner?.querySelector<HTMLElement>('.el-input__prefix'),
    owner?.querySelector<HTMLElement>('.el-date-editor'),
    el,
  ];
  return candidates.find((candidate) => candidate && isVisible(candidate)) ?? el;
}

function isFillable(el: HTMLElement): boolean {
  if (!el.matches(SCANNABLE_SELECTOR)) return false;
  if (isInsideEphemeralOverlay(el)) return false;
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
  el = resolveLiveControl(el);
  if (el instanceof HTMLInputElement && el.type === 'file') {
    return Array.from(el.files ?? []).map((file) => file.name).join(', ');
  }
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    return el.checked ? (el.value || 'true') : '';
  }
  if (el instanceof HTMLInputElement) {
    return collectDisplayValueCandidates(buildDomControlProbe(el))[0] ?? '';
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
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

function findAncestorQuestionText(el: HTMLElement): string {
  const levels: string[][] = [];
  const seen = new Set<HTMLTableRowElement>();
  let row = el.closest<HTMLTableRowElement>('tr');
  let anchor: HTMLElement = el;

  while (row && levels.length < 5 && !seen.has(row)) {
    seen.add(row);
    const cells = Array.from(row.cells);
    const carrierIndex = cells.findIndex((cell) => cell === anchor || cell.contains(anchor));
    levels.push(carrierIndex > 0
      ? cells.slice(0, carrierIndex).map((cell) => textWithoutControls(cell))
      : []);
    anchor = row;
    row = row.parentElement?.closest<HTMLTableRowElement>('tr') ?? null;
  }

  return chooseNearestAncestorQuestionContext(levels);
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
    ['学习和工作经历', /学习.{0,3}工作(?:经历|履历)|教育经历|工作经历|学习经历/],
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

function inferProfileGroupFromTable(tableRoot: HTMLElement): string {
  const headers = Array.from(tableRoot.querySelectorAll<HTMLElement>('th,thead td'))
    .map((cell) => textWithoutControls(cell))
    .filter(Boolean);
  return classifyRepeatableHeaderSchema(headers);
}

function findNearestHeadingText(el: HTMLElement): string {
  const headings = Array.from(document.querySelectorAll<HTMLElement>(
    'h1,h2,h3,h4,legend,.title,.form-title,.panel-title,.info-group,.res-title',
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
  const knownGroupLabel = table
    ? inferProfileGroupFromTable(table) || detectProfileGroup(nearestHeading)
    : detectProfileGroup(nearestHeading || groupText);

  if (!row || !table) {
    return {
      groupLabel: knownGroupLabel,
      columnLabel: '',
      repeatGroup: knownGroupLabel,
    };
  }

  const dataRows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
    .filter((candidate) => countEditables(candidate) >= 2);
  const rowIndex = dataRows.indexOf(row);
  const columnLabel = getTableColumnLabel(el, table, row);
  const scope = table.parentElement ?? table;
  const hasAddControl = Array.from(scope.querySelectorAll<HTMLElement>('button,a,[role="button"],input[type="button"]'))
    .filter(isVisible)
    .some((candidate) => isAddRowLabel(normalizeText(
      candidate instanceof HTMLInputElement ? candidate.value : candidate.textContent ?? '',
    )));
  const classification = classifyObservedRepeatTable({
    knownGroupLabel,
    nearestHeading: nearestHeading || groupText,
    rowEditableCounts: dataRows.map((candidate) => countEditables(candidate)),
    columnLabels: dataRows[0]
      ? Array.from(dataRows[0].querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR))
          .filter(isFillable)
          .map((field) => getTableColumnLabel(field, table, dataRows[0]))
      : [],
    hasAddControl,
  });
  if (!classification.repeatable || rowIndex < 0) {
    return {
      groupLabel: knownGroupLabel,
      columnLabel: '',
      repeatGroup: knownGroupLabel,
    };
  }

  return {
    groupLabel: classification.groupLabel,
    columnLabel,
    rowIndex,
    repeatGroup: classification.groupLabel || normalizeText(table.getAttribute('id') ?? table.getAttribute('class') ?? ''),
  };
}

function repeatDataRows(tableRoot: HTMLElement): HTMLElement[] {
  return Array.from(tableRoot.querySelectorAll<HTMLElement>('tr'))
    .filter((candidate) => countEditables(candidate) >= 2);
}

const REPEAT_GROUP_HEADING_SELECTOR = 'h1,h2,h3,h4,legend,.title,.form-title,.panel-title,.info-group,.res-title';
const REPEAT_GROUP_TABLE_ROOT_SELECTOR = 'table,.adv-vxe-table,adv-vxe-table';
const REPEAT_ADD_CONTROL_SELECTOR = 'button,a,[role="button"],span,input[type="button"]';

interface RepeatGroupSurface {
  groupLabel: string;
  tableRoot: HTMLElement;
  addControl?: HTMLElement;
  presentation: 'adjacent' | 'legacy-table';
}

function isRepeatAddControlCandidate(candidate: HTMLElement): boolean {
  if (!isVisible(candidate) || (candidate as HTMLButtonElement).disabled) return false;
  if (candidate instanceof HTMLSpanElement) {
    const style = (candidate.ownerDocument.defaultView ?? window).getComputedStyle(candidate);
    const clickable = candidate.getAttribute('role') === 'button'
      || candidate.hasAttribute('onclick')
      || candidate.tabIndex >= 0
      || style.cursor === 'pointer';
    if (!clickable) return false;
  }
  const visibleText = normalizeText(
    candidate instanceof HTMLInputElement ? candidate.value : candidate.textContent ?? '',
  ).replace(/\s+/g, '');
  const accessibleLabel = normalizeText([
    candidate.getAttribute('aria-label') ?? '',
    candidate.getAttribute('title') ?? '',
  ].join(' ')).replace(/\s+/g, '').toLowerCase();
  return isAddRowLabel(visibleText) || isAddRowLabel(accessibleLabel);
}

function findAddControlWithin(root: HTMLElement): HTMLElement | undefined {
  const candidates = [
    ...(root.matches(REPEAT_ADD_CONTROL_SELECTOR) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(REPEAT_ADD_CONTROL_SELECTOR)),
  ];
  return candidates.find(isRepeatAddControlCandidate);
}

function adjacentRepeatGroupSurface(
  heading: HTMLElement,
  targetGroup: string,
): RepeatGroupSurface | undefined {
  const headingGroup = detectProfileGroup(textWithoutControls(heading));
  const following: Array<RepeatGroupSurfaceNode<HTMLElement>> = [];
  let sibling = heading.nextElementSibling as HTMLElement | null;
  for (let step = 0; sibling && step < 12; step++, sibling = sibling.nextElementSibling as HTMLElement | null) {
    const nextHeadingGroup = sibling.matches(REPEAT_GROUP_HEADING_SELECTOR)
      ? detectProfileGroup(textWithoutControls(sibling))
      : '';
    const addControl = findAddControlWithin(sibling);
    const kind = nextHeadingGroup
      ? 'heading'
      : sibling.matches(REPEAT_GROUP_TABLE_ROOT_SELECTOR)
        ? 'table'
        : addControl
          ? 'add'
          : 'other';
    following.push({
      id: kind === 'add' && addControl ? addControl : sibling,
      kind,
      visible: kind === 'add' && addControl ? isVisible(addControl) : isVisible(sibling),
    });
    if (kind === 'heading') break;
  }
  const selection = selectAdjacentRepeatGroupSurface({ targetGroup, headingGroup, following });
  if (!selection.tableId) return undefined;
  return {
    groupLabel: targetGroup,
    tableRoot: selection.tableId,
    addControl: selection.addControlId,
    presentation: 'adjacent',
  };
}

function findLegacyRepeatTable(groupLabel: string): HTMLTableElement | undefined {
  return Array.from(document.querySelectorAll<HTMLTableElement>('table'))
    .filter((table) => !table.closest('.adv-vxe-table,adv-vxe-table'))
    .find((table) => {
    const localHeading = findNearestHeadingText(table);
    const detectedGroup = inferProfileGroupFromTable(table) || detectProfileGroup(joinUnique([
      normalizeText(table.caption?.textContent ?? ''),
      localHeading,
    ]));
    return detectedGroup === groupLabel;
  });
}

function findRepeatGroupSurface(groupLabel: string): RepeatGroupSurface | undefined {
  const adjacent = Array.from(document.querySelectorAll<HTMLElement>(REPEAT_GROUP_HEADING_SELECTOR))
    .filter(isVisible)
    .map((heading) => adjacentRepeatGroupSurface(heading, groupLabel))
    .filter((surface): surface is RepeatGroupSurface => Boolean(surface));
  if (adjacent.length === 1) return adjacent[0];
  if (adjacent.length > 1) return undefined;

  const table = findLegacyRepeatTable(groupLabel);
  return table ? {
    groupLabel,
    tableRoot: table,
    presentation: 'legacy-table',
  } : undefined;
}

function findAddRowControl(surface: RepeatGroupSurface): HTMLElement | undefined {
  if (surface.addControl?.isConnected && isRepeatAddControlCandidate(surface.addControl)) {
    return surface.addControl;
  }
  const table = surface.tableRoot;
  if (!(table instanceof HTMLTableElement)) return undefined;
  let container: HTMLElement | null = table.parentElement;
  for (let depth = 0; container && container !== document.body && depth < 5; depth++, container = container.parentElement) {
    const control = Array.from(container.querySelectorAll<HTMLElement>('button,a,[role="button"],span')).find((candidate) => {
      if (!isRepeatAddControlCandidate(candidate)) return false;
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
      return true;
    });
    if (control) return control;
  }
  return undefined;
}

function repeatTableHeaders(tableRoot: HTMLElement): string[] {
  const headers = Array.from(tableRoot.querySelectorAll<HTMLElement>('th,thead td'))
    .map((cell) => textWithoutControls(cell))
    .filter(Boolean);
  if (headers.length > 0) return [...new Set(headers)];
  const firstStaticRow = Array.from(tableRoot.querySelectorAll<HTMLTableRowElement>('tr'))
    .find((row) => countEditables(row) === 0);
  return firstStaticRow
    ? [...new Set(Array.from(firstStaticRow.cells).map((cell) => textWithoutControls(cell)).filter(Boolean))]
    : [];
}

function observeRepeatGroups(): RepeatableGroupObservation[] {
  const scanned = scanFields().map((result) => ({ ...result.field, index: result.index }));
  const labels = new Set<string>();
  for (const field of scanned) {
    const label = normalizeText(field.repeatGroup || field.groupLabel);
    if (label) labels.add(label);
  }
  for (const heading of Array.from(document.querySelectorAll<HTMLElement>(REPEAT_GROUP_HEADING_SELECTOR)).filter(isVisible)) {
    const label = detectProfileGroup(textWithoutControls(heading));
    if (label) labels.add(label);
  }
  for (const table of Array.from(document.querySelectorAll<HTMLElement>(REPEAT_GROUP_TABLE_ROOT_SELECTOR)).filter(isVisible)) {
    const label = inferProfileGroupFromTable(table) || detectProfileGroup(findGroupText(table, table instanceof HTMLTableElement ? table : null));
    if (label) labels.add(label);
  }

  return [...labels].map((groupLabel) => {
    const fields = scanned.filter((field) => normalizeText(field.repeatGroup || field.groupLabel) === groupLabel);
    const surface = findRepeatGroupSurface(groupLabel);
    const matchingDialog = findVisibleRepeatDialogForGroup(groupLabel);
    let nearbyAdd: HTMLElement | undefined;
    if (surface) nearbyAdd = findAddRowControl(surface);
    if (!nearbyAdd) {
      const heading = Array.from(document.querySelectorAll<HTMLElement>(REPEAT_GROUP_HEADING_SELECTOR))
        .filter(isVisible)
        .find((candidate) => detectProfileGroup(textWithoutControls(candidate)) === groupLabel);
      if (heading) {
        let sibling = heading.nextElementSibling as HTMLElement | null;
        for (let step = 0; sibling && step < 12 && !nearbyAdd; step++, sibling = sibling.nextElementSibling as HTMLElement | null) {
          nearbyAdd = findAddControlWithin(sibling);
          if (sibling.matches(REPEAT_GROUP_HEADING_SELECTOR)) break;
        }
      }
    }
    const rowIndexes = [...new Set(fields.map((field) => field.rowIndex).filter((value): value is number => value != null))];
    return {
      groupLabel,
      presentation: matchingDialog ? 'dialog' : surface?.presentation === 'legacy-table' ? 'inline' : surface ? 'inline' : 'unknown',
      tableHeaders: surface ? repeatTableHeaders(surface.tableRoot) : [],
      fieldLabels: [...new Set(fields.map((field) => normalizeText(field.columnLabel || field.label)).filter(Boolean))],
      currentRowCount: surface ? repeatDataRows(surface.tableRoot).length : rowIndexes.length,
      hasAddControl: Boolean(nearbyAdd),
      addControlLabel: nearbyAdd ? normalizeText(nearbyAdd instanceof HTMLInputElement ? nearbyAdd.value : nearbyAdd.textContent ?? '') : undefined,
      dialogVisible: Boolean(matchingDialog),
    } satisfies RepeatableGroupObservation;
  });
}

async function waitForRowOrRepeatDialog(
  tableRoot: HTMLElement,
  previousCount: number,
  groupLabel: string,
  beforeRoots: ReadonlySet<HTMLElement>,
): Promise<'row' | 'dialog' | 'ambiguous-dialog' | 'none'> {
  for (let attempt = 0; attempt < 16; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 75));
    if (repeatDataRows(tableRoot).length > previousCount) return 'row';
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
  await forEachRepeatPreparationTarget(targets, async (target) => {
    const surface = findRepeatGroupSurface(target.groupLabel);
    if (!surface) {
      return 'continue';
    }
    const currentRows = repeatDataRows(surface.tableRoot).length;
    const preparationPlan = planRepeatRowPreparation(target.requiredRows, currentRows);
    if (preparationPlan.truncated) {
      failures.push({
        groupLabel: target.groupLabel,
        reason: `Requested row count requires more than ${MAX_REPEAT_ROW_ADDITIONS_PER_PASS} additions in one pass`,
      });
    }
    while (repeatDataRows(surface.tableRoot).length < preparationPlan.targetRows) {
      const previousCount = repeatDataRows(surface.tableRoot).length;
      const control = findAddRowControl(surface);
      if (!control) {
        if (classifyRepeatPreparation({ tableMatch: 'strong', hasAddControl: false }) === 'failure') {
          failures.push({ groupLabel: target.groupLabel, reason: 'No visible add-row control found' });
        }
        break;
      }
      try {
        const beforeRoots = new Set(getVisibleDialogRoots());
        control.click();
        const outcome = await waitForRowOrRepeatDialog(surface.tableRoot, previousCount, target.groupLabel, beforeRoots);
        if (outcome === 'dialog') {
          dialogGroups.add(target.groupLabel);
          return 'stop';
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
    return 'continue';
  });
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

const AGENT_PAGE_TEXT_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'legend',
  'label',
  'th',
  'caption',
  '[role="heading"]',
  '.page-title',
  '.form-title',
  '.panel-title',
  '.section-title',
  '.card-title',
  '.help-block',
  '.help-text',
  '.form-text',
  '.tip',
  '.tips',
  '.hint',
  '.notice',
  '.description',
  '.remark',
  '.instruction',
  '.el-form-item__label',
  '.ant-form-item-label',
  '.ivu-form-item-label',
  '.layui-form-label',
  'nav .active',
  'aside .active',
  '[role="navigation"] .active',
  '[aria-current="step"]',
  '.steps .active',
  '.step.active',
  '.el-step__title.is-process',
  '.ant-steps-item-process .ant-steps-item-title',
].join(',');

function safeAgentPageText(element: HTMLElement): string {
  if (element.closest('script,style,noscript,template')) return '';
  const text = textWithoutControls(element);
  return normalizeAgentPageText(text);
}

function getAgentPageContext(): AgentPageSemanticContext {
  const meta = getPageMeta();
  const semantic = buildAgentPageSemanticText(
    Array.from(document.querySelectorAll<HTMLElement>(AGENT_PAGE_TEXT_SELECTOR))
      .filter(isVisible)
      .map(safeAgentPageText)
      .filter(Boolean),
  );
  const title = normalizeText(document.title);
  return {
    title: title && !isSensitiveAgentPageText(title) ? title : meta.label,
    stepText: meta.label,
    ...semantic,
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
  const before = { url: location.href, signature: nextPageSignature() };
  control.scrollIntoView({ behavior: 'smooth', block: 'center' });
  control.click();

  const transition = await waitForPageTransition({
    initial: before,
    readCurrent: () => ({ url: location.href, signature: nextPageSignature() }),
  });
  if (transition.changed) return { clicked: true, advanced: true, reason: '已进入下一页' };
  return { clicked: true, advanced: false, reason: '页面没有切换，可能仍有校验项需要本人处理' };
}

function findSafePreviousControl(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    'button,input[type="button"],a,[role="button"]',
  ));
  return candidates.find((candidate) => {
    if (!isVisible(candidate) || (candidate as HTMLButtonElement).disabled) return false;
    const text = (candidate as HTMLInputElement).value || candidate.textContent || '';
    return isSafePreviousStepLabel(text);
  }) ?? null;
}

async function returnToPreviousStep(): Promise<{ clicked: boolean; advanced: boolean; reason: string }> {
  const control = findSafePreviousControl();
  if (!control) return { clicked: false, advanced: false, reason: '未找到安全的上一步按钮' };
  const before = { url: location.href, signature: nextPageSignature() };
  control.scrollIntoView({ behavior: 'smooth', block: 'center' });
  control.click();
  const transition = await waitForPageTransition({
    initial: before,
    readCurrent: () => ({ url: location.href, signature: nextPageSignature() }),
  });
  return transition.changed
    ? { clicked: true, advanced: true, reason: '已返回上一页' }
    : { clicked: true, advanced: false, reason: '点击上一步后页面没有切换' };
}

function getProtection(el: HTMLElement, fieldText: string, isFile: boolean): { protected: boolean; reason: string } {
  if (isFile) return { protected: true, reason: '文件上传需本人确认' };
  if ((el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled) {
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

function findExistingPreviewImage(input: HTMLInputElement): HTMLImageElement | undefined {
  const container = getSemanticContainer(input);
  return Array.from(container.querySelectorAll<HTMLImageElement>('img[src]')).find((image) => {
    if (!isVisible(image)) return false;
    const descriptor = `${image.alt} ${image.className} ${image.src}`.toLowerCase();
    if (/logo|icon|captcha|verify|qrcode|二维码|验证码/.test(descriptor)) return false;
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || rect.width;
    const height = image.naturalHeight || rect.height;
    return width >= 60 && height >= 60;
  });
}

async function getExistingMaterialPreview(index: number): Promise<{
  ok: boolean;
  dataUrl: string;
  mimeType: string;
  evidence: string;
  error?: string;
}> {
  if (!elementMap.has(index)) scanFields();
  const input = elementMap.get(index);
  if (!(input instanceof HTMLInputElement) || input.type !== 'file') {
    return { ok: false, dataUrl: '', mimeType: '', evidence: '', error: '上传项已不在当前页面' };
  }
  const evidence = findExistingFileEvidence(input);
  const image = findExistingPreviewImage(input);
  if (!image) {
    return { ok: true, dataUrl: '', mimeType: '', evidence: evidence || '网页已有材料' };
  }
  const source = image.currentSrc || image.src;
  if (source.startsWith('data:image/')) {
    return { ok: true, dataUrl: source, mimeType: source.slice(5, source.indexOf(';')) || 'image/*', evidence };
  }
  try {
    const response = await fetch(source, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size > 3 * 1024 * 1024) {
      return { ok: true, dataUrl: '', mimeType: blob.type, evidence };
    }
    const declaredType = blob.type.toLowerCase();
    const mimeType = declaredType.startsWith('image/')
      ? declaredType
      : inferImageMimeType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
    if (!mimeType) return { ok: true, dataUrl: '', mimeType: blob.type, evidence };
    const previewBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(previewBlob);
    });
    return { ok: true, dataUrl, mimeType, evidence };
  } catch {
    return { ok: true, dataUrl: '', mimeType: '', evidence };
  }
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

  const previewImage = findExistingPreviewImage(input);
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
  const ancestorQuestionText = findAncestorQuestionText(el);

  return joinUnique([localText, nearbyText, ancestorQuestionText]);
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
  const label = repeatMeta.columnLabel
    || getControlAttribute(el, 'label')
    || getControlAttribute(el, 'caption')
    || getPairedSelectorLabel(el)
    || findLabel(el);
  const hint = findHint(el, label, context);
  const fieldText = joinUnique([repeatMeta.groupLabel, repeatMeta.columnLabel, label, hint, context]);
  const protection = getProtection(el, fieldText, isFile);
  const required = isRequiredField(el, fieldText);
  const explicitDateFormat = [
    el.getAttribute('data-date-format'),
    el.getAttribute('data-datefmt'),
    getControlAttribute(el, 'value-format'),
    getControlAttribute(el, 'format'),
    getControlAttribute(el, 'pattern'),
    el.getAttribute('onclick')?.match(/dateFmt\s*:\s*['"]([^'"]+)['"]/i)?.[1],
  ].find(Boolean) ?? '';
  const rules = extractAgentFieldRules({
    texts: [label, hint, context, fieldText],
    explicitDateFormat,
    domMaxLength: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.maxLength
      : undefined,
  });
  const existingFile = isFile ? findExistingFileEvidence(el as HTMLInputElement) : '';
  return {
    kind: isFile ? 'file' : 'text',
    tag,
    type: (el as HTMLInputElement).type ?? tag,
    name: getControlAttribute(el, 'name') || getControlAttribute(el, 'prop'),
    id: el.getAttribute('id') ?? '',
    label,
    hint,
    placeholder: el.getAttribute('placeholder') ?? getControlAttribute(el, 'placeholder'),
    ariaLabel: el.getAttribute('aria-label') ?? '',
    title: el.getAttribute('title') ?? '',
    dateFormat: rules.dateFormat,
    maxLength: rules.maxLength,
    forbiddenCharacters: rules.forbiddenCharacters,
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

async function waitForVisibleEditableSurface(timeoutMs = 3500): Promise<void> {
  if (Array.from(document.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR)).some(isFillable)) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (Array.from(document.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR)).some(isFillable)) return;
  }
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
  el = resolveLiveControl(el);
  ensureMarkerStyles();
  if (el.dataset.autoFillerOriginalTitle == null) {
    el.dataset.autoFillerOriginalTitle = el.getAttribute('title') ?? '';
  }
  el.dataset.autoFillerStatus = status;
  const questionCell = findRepeatableQuestionCell(el);
  if (questionCell) alignRepeatableQuestionCell(questionCell);
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
  document.querySelectorAll<HTMLElement>('[data-baotian-layout-adjusted]').forEach(restoreRepeatableQuestionCell);
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

async function waitForElementValue(
  el: HTMLElement,
  expected: string,
  timeoutMs = 1600,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const live = resolveLiveControl(el);
    if (!live.isConnected) return false;
    if (valueMatches(live, expected)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const live = resolveLiveControl(el);
  return live.isConnected && valueMatches(live, expected);
}

function collectVisibleDialogRoots(): HTMLElement[] {
  const rootSelector = [
    '[role="dialog"]',
    '.modal',
    '.dialog',
    '.popup',
    '.drawer',
    '.layui-layer',
    '.ui-dialog',
    '.el-dialog',
    '.el-drawer',
    '.ant-modal',
    '.ant-drawer',
    '.ivu-drawer',
    '.vxe-modal',
    '.window',
    ...getOverlayRootSelectors('select'),
    ...getOverlayRootSelectors('cascader'),
    ...getOverlayRootSelectors('date-picker'),
  ].join(',');
  const visibleRoots = Array.from(document.querySelectorAll<HTMLElement>(rootSelector))
    .filter((candidate) => isVisible(candidate) || isActionableOverlayRoot(candidate));
  const roots = visibleRoots.filter((candidate) => !visibleRoots.some(
    (other) => other !== candidate && other.contains(candidate),
  ));
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

function findVisibleRepeatDialogForGroup(groupLabel: string): HTMLElement | undefined {
  return findUniqueRepeatDialogRoot(groupLabel).root;
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
  const surface = findRepeatGroupSurface(groupLabel);
  if (!surface) return { recordCount: 0, text: '' };
  return {
    recordCount: repeatDataRows(surface.tableRoot).length,
    text: textWithoutControls(surface.tableRoot),
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

function findSafeRepeatDialogCancelControl(
  root: HTMLElement,
): { control?: HTMLElement; reason: 'record-cancel' | 'ambiguous-record-cancel' | 'no-record-cancel' } {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('button,a,input[type="button"],[role="button"]'))
    .filter((control) => isVisible(control) && !(control as HTMLButtonElement).disabled)
    .map((control) => ({
      id: control,
      label: visibleControlLabel(control),
      recordAssociated: isRecordAssociatedRepeatDialogSaveControl(root, control),
    }));
  const selection = selectRepeatDialogCancelCandidate(candidates);
  return { control: selection.id, reason: selection.reason };
}

async function dismissRepeatDialog(root: HTMLElement, timeoutMs = 1200): Promise<boolean> {
  const cancel = findSafeRepeatDialogCancelControl(root);
  if (!cancel.control) return false;
  try {
    cancel.control.click();
  } catch {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!root.isConnected || !isVisible(root)) return true;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return !root.isConnected || !isVisible(root);
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
    label: pickRepeatDialogFieldLabel(entry.field),
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

async function commitRepeatRecord(groupLabel: string): Promise<CommitRepeatRecordResult> {
  const dialog = findUniqueRepeatDialogRoot(groupLabel);
  const root = dialog.root;
  if (!root) {
    return { groupLabel, committed: false, reason: dialog.reason };
  }
  if (findUnsafeRepeatDialogControl(root)) {
    return { groupLabel, committed: false, reason: 'protected-control-visible' };
  }
  const entries = collectRepeatDialogEntries(root);
  const validation = validateRepeatDialogCommit(entries.map((entry) => ({
    required: Boolean(entry.field.required),
    protected: Boolean(entry.field.protected),
    kind: entry.field.kind,
    value: getCurrentValue(entry.el),
  })));
  if (!validation.safe) {
    return { groupLabel, committed: false, reason: validation.reason };
  }
  const save = findSafeRepeatDialogSaveControl(root);
  if (!save.control) {
    return { groupLabel, committed: false, reason: save.reason };
  }
  const beforeSnapshot = captureRepeatGroupSnapshot(groupLabel);
  const assignedValues = entries
    .map((entry) => getCurrentValue(entry.el).trim())
    .filter(Boolean);
  if (assignedValues.length === 0) {
    return { groupLabel, committed: false, reason: 'record-empty' };
  }
  try {
    save.control.click();
  } catch {
    return { groupLabel, committed: false, reason: 'record-save-click-failed' };
  }
  const verification = await waitForRepeatDialogSave(root, groupLabel, beforeSnapshot, assignedValues);
  return {
    groupLabel,
    committed: verification !== 'unverified',
    reason: verification,
  };
}

async function prepareRepeatRecords(
  targets: PrepareRepeatRecordsMessage['targets'],
): Promise<PrepareRepeatRecordsResult> {
  let added = 0;
  let processed = 0;
  let blocked = false;
  const dismissedGroups = new Set<string>();
  const failures: PrepareRepeatRecordsResult['failures'] = [];
  for (const target of targets) {
    const recordBatch = limitRepeatRecordBatch(target.records);
    if (recordBatch.truncated) {
      failures.push({
        groupLabel: target.groupLabel,
        presentation: 'dialog',
        reason: `Requested record count exceeds the safe batch of ${MAX_REPEAT_ROW_ADDITIONS_PER_PASS}`,
      });
    }
    for (const record of recordBatch.records) {
      const surface = findRepeatGroupSurface(target.groupLabel);
      if (!surface) {
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
        const control = findAddRowControl(surface);
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
        if (await dismissRepeatDialog(root)) {
          dismissedGroups.add(target.groupLabel);
        } else {
          blocked = true;
        }
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
        if (await dismissRepeatDialog(root)) {
          dismissedGroups.add(target.groupLabel);
        } else {
          blocked = true;
        }
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
        blocked = true;
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
  return { added, processed, blocked, dismissedGroups: [...dismissedGroups], failures };
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
      '[role="option"],[role="menuitem"],li,td,a,button,.option,.item,.tree-node,.el-tree-node__label,.el-cascader-node,.el-cascader-node__label,.ant-select-item-option-content,.ant-cascader-menu-item',
    )).filter((candidate) => (
      (isVisible(candidate) || isActionableOverlayChoice(root, candidate))
      && candidate.childElementCount <= 3
    ));
    const exact = candidates
      .filter((candidate) => {
        const text = normalizeSelectionText(candidate.textContent ?? '');
        return text === wanted
          || comparable(text) === comparable(wanted)
          || selectionTextsEquivalent(text, wanted);
      })
      .sort((a, b) => normalizeSelectionText(a.textContent ?? '').length - normalizeSelectionText(b.textContent ?? '').length)[0];
    if (exact) {
      const clickableChild = Array.from(exact.querySelectorAll<HTMLElement>(
        'a,button,[role="option"],[role="menuitem"],[role="treeitem"],.option,.item,.tree-node,.el-tree-node__label,.el-cascader-node,.el-cascader-node__label,.ant-select-item-option-content,.ant-cascader-menu-item',
      )).find((candidate) => (
        comparable(candidate.textContent ?? '') === comparable(wanted)
        || selectionTextsEquivalent(candidate.textContent ?? '', wanted)
      ));
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
  const live = resolveLiveControl(el);
  const rawValue = live instanceof HTMLInputElement || live instanceof HTMLTextAreaElement
    ? live.value
    : '';
  if (datePickerValuesEquivalent(rawValue, expected)) return true;
  if (selectionTextsEquivalent(rawValue, expected)) return true;
  const compactRaw = normalizeSelectionText(rawValue).replace(/^\d{4,12}/, '').replace(/[|/>\\,，;；\s-]+/g, '');
  const compactExpected = normalizeSelectionText(expected).replace(/^\d{4,12}/, '').replace(/[|/>\\,，;；\s-]+/g, '');
  if (compactRaw && compactExpected && (compactRaw.includes(compactExpected) || compactExpected.includes(compactRaw))) {
    return true;
  }
  if (valueMatches(el, expected)) return true;
  const currentValue = getCurrentValue(el);
  if (datePickerValuesEquivalent(currentValue, expected)) return true;
  if (selectionTextsEquivalent(currentValue, expected)) return true;
  const actual = normalizeSelectionText(currentValue).replace(/^\d{4,12}/, '').replace(/[|/>\\,，;；\s-]+/g, '');
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
  // Element UI creates the dropdown immediately, but its enter transition can
  // leave the root at zero height for a short period. Returning that root too
  // early makes the option click race the close state machine and leaves the
  // dropdown covering the next field. Keep it as a last-resort fallback only.
  let enteringFallback: HTMLElement | null = null;
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
    if (selected != null) {
      const root = roots[Number(selected)] ?? null;
      if (root) {
        const rect = root.getBoundingClientRect();
        const style = (root.ownerDocument.defaultView ?? window).getComputedStyle(root);
        const entering = /(?:^|\s)el-[^\s]*-enter-active(?:\s|$)/u.test(style.cssText || '')
          || /(?:^|\s)el-[^\s]*-enter-active(?:\s|$)/u.test(typeof root.className === 'string' ? root.className : '');
        // isVisible() intentionally accepts an element with only width or
        // height. For a transient popper that is too permissive: Element UI
        // can expose a width while the enter transition still has zero height.
        if (isVisible(root) && rect.width > 0 && rect.height > 0 && !entering) return root;
      }
      if (root && isActionableOverlayRoot(root)) enteringFallback = root;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return enteringFallback;
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

function cascaderCandidates(root: HTMLElement): Array<{ element: HTMLElement; label: string }> {
  const controls = Array.from(root.querySelectorAll<HTMLElement>(
    '.el-cascader-node,[role="menuitem"],.ant-cascader-menu-item',
  )).filter((candidate) => (
    isVisible(candidate)
    && !candidate.classList.contains('is-disabled')
    && candidate.getAttribute('aria-disabled') !== 'true'
  ));
  return controls.map((element) => ({
    element,
    label: normalizeSelectionText(
      element.querySelector<HTMLElement>('.el-cascader-node__label')?.textContent
      ?? element.textContent
      ?? '',
    ),
  })).filter((candidate) => Boolean(candidate.label));
}

function firstLevelCascaderCandidates(root: HTMLElement): Array<{ element: HTMLElement; label: string }> {
  const firstMenu = root.matches('.el-cascader-menu,.ant-cascader-menu')
    ? root
    : root.querySelector<HTMLElement>('.el-cascader-menu,.ant-cascader-menu');
  if (!firstMenu) return cascaderCandidates(root);
  return cascaderCandidates(firstMenu).filter((candidate) => (
    candidate.element.closest('.el-cascader-menu,.ant-cascader-menu') === firstMenu
  ));
}

async function waitForCascaderSegment(
  root: HTMLElement,
  remaining: string,
  timeoutMs = 1800,
): Promise<{ element: HTMLElement; label: string; remaining: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = cascaderCandidates(root);
    const segment = pickHierarchicalSegment(remaining, candidates.map((candidate) => candidate.label));
    if (segment) {
      const candidate = candidates.find((item) => item.label === segment.label);
      if (candidate) return { ...candidate, remaining: segment.remaining };
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

function activateCascaderNode(element: HTMLElement, isTerminal: boolean): void {
  const node = element.closest<HTMLElement>('.el-cascader-node,[role="menuitem"],.ant-cascader-menu-item')
    ?? element;
  const target = getCascaderNodeActivationSelectors(isTerminal)
    .map((selector) => (node.matches(selector) ? node : node.querySelector<HTMLElement>(selector)))
    .find((candidate): candidate is HTMLElement => Boolean(candidate && isVisible(candidate)));
  (target ?? element).click();
}

async function searchCascaderBranches(root: HTMLElement, value: string): Promise<HTMLElement | null> {
  const initialCandidates = firstLevelCascaderCandidates(root);
  const branchLabels = pickCascaderExplorationLabels(
    value,
    initialCandidates.map((candidate) => candidate.label),
  );
  lastCascaderTrace.push(`branches:${branchLabels.length}`);
  for (const label of branchLabels.slice(0, 60)) {
    const branch = firstLevelCascaderCandidates(root).find((candidate) => candidate.label === label);
    if (!branch) continue;
    activateCascaderNode(branch.element, false);
    const direct = await waitForDialogChoice(root, value, 320);
    if (direct) {
      lastCascaderTrace.push(`matched:${label}`);
      return direct;
    }
  }
  lastCascaderTrace.push('matched:none');
  return null;
}

async function fillCascaderSelection(
  el: HTMLElement,
  root: HTMLElement,
  value: string,
  confidence: 'high' | 'medium' | 'low',
): Promise<boolean> {
  lastCascaderTrace = [`target:${value}`];
  let remaining = normalizeSelectionText(value).replace(/[>／/、,，\s]+/g, '');
  for (let depth = 0; remaining && depth < 8; depth++) {
    const segment = await waitForCascaderSegment(root, remaining, depth === 0 ? 900 : 1800);
    if (!segment) {
      let direct = await waitForDialogChoice(root, value, 160);
      const search = Array.from(root.querySelectorAll<HTMLInputElement>(
        '.base-select-filter input,input[type="search"],input[type="text"],input:not([type])',
      )).find((input) => input !== el && isVisible(input) && !input.readOnly && !input.disabled);
      if (!direct && search) {
        setDialogSearchValue(search, value);
        direct = await waitForDialogChoice(root, value, 2200);
      }
      if (!direct && !search) direct = await searchCascaderBranches(root, value);
      if (!direct) {
        markField(el, 'review');
        return false;
      }
      activateCascaderNode(direct, true);
      remaining = '';
      break;
    }
    activateCascaderNode(segment.element, segment.remaining === '');
    remaining = segment.remaining;
    if (remaining) await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await waitForDialogValue(el, value, 1200);
  const verified = dialogValueMatches(el, value);
  markField(el, verified ? (confidence === 'high' ? 'verified' : 'review') : 'mismatch');
  return verified;
}

function elementPickerMonth(root: HTMLElement): { year: number; month: number } | null {
  const labels = Array.from(root.querySelectorAll<HTMLElement>('.el-date-picker__header-label'))
    .map((label) => normalizeText(label.textContent ?? ''));
  const year = Number(labels.find((label) => /\d{4}\s*年/.test(label))?.match(/\d{4}/)?.[0]);
  const month = Number(labels.find((label) => /\d{1,2}\s*月/.test(label))?.match(/\d{1,2}/)?.[0]);
  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
    ? { year, month }
    : null;
}

async function waitForElementPickerMonth(
  root: HTMLElement,
  previous: { year: number; month: number },
  timeoutMs = 700,
): Promise<{ year: number; month: number } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = elementPickerMonth(root);
    if (current && (current.year !== previous.year || current.month !== previous.month)) return current;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return elementPickerMonth(root);
}

async function fillDatePicker(
  el: HTMLInputElement,
  value: string,
  confidence: 'high' | 'medium' | 'low',
): Promise<boolean> {
  const target = parseDatePickerTarget(value);
  if (!target) return false;
  const beforeRoots = new Set(collectVisibleDialogRoots());
  findDatePickerTrigger(el).click();
  const field = extractField(el);
  const fieldText = joinUnique([field.label, field.hint, field.context, field.ariaLabel, field.title]);
  const root = await waitForSelectionDialogRoot(fieldText, beforeRoots);
  if (!root) {
    markField(el, 'review');
    return false;
  }

  let current = elementPickerMonth(root);
  if (!current) {
    markField(el, 'review');
    return false;
  }
  for (let steps = 0; steps < 240; steps++) {
    const delta = (target.year - current.year) * 12 + (target.month - current.month);
    if (delta === 0) break;
    const selector = delta < 0
      ? '.el-date-picker__prev-btn.el-icon-arrow-left'
      : '.el-date-picker__next-btn.el-icon-arrow-right';
    const control = root.querySelector<HTMLElement>(selector);
    if (!control || !isVisible(control)) {
      markField(el, 'review');
      return false;
    }
    control.click();
    const next = await waitForElementPickerMonth(root, current);
    if (!next || (next.year === current.year && next.month === current.month)) {
      markField(el, 'review');
      return false;
    }
    current = next;
  }
  if (current.year !== target.year || current.month !== target.month) {
    markField(el, 'review');
    return false;
  }

  const wantedDay = String(target.day ?? 1);
  const dayCell = Array.from(root.querySelectorAll<HTMLElement>(
    '.el-date-table td.available:not(.prev-month):not(.next-month)',
  )).find((cell) => normalizeText(cell.querySelector('.cell')?.textContent ?? cell.textContent ?? '') === wantedDay);
  if (!dayCell) {
    markField(el, 'review');
    return false;
  }
  (dayCell.querySelector<HTMLElement>('.cell') ?? dayCell).click();
  await waitForDialogValue(el, value, 1400);
  const verified = dialogValueMatches(el, value);
  markField(el, verified ? (confidence === 'high' ? 'verified' : 'review') : 'mismatch');
  return verified;
}

async function fillDialogSelection(
  el: HTMLElement,
  value: string,
  confidence: 'high' | 'medium' | 'low',
): Promise<boolean> {
  const interactionPlan = createDomControlInteractionPlan(buildDomControlProbe(el));
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
  if (interactionPlan.kind === 'cascader') {
    return fillCascaderSelection(el, dialogRoot, value, confidence);
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
  if (verified) {
    markField(el, confidence === 'high' ? 'verified' : 'review');
    return true;
  }

  // Some page frameworks finish propagating a programmatic option click only
  // after the extension message task unwinds. The exact option was found and
  // clicked, so keep the task moving and perform the authoritative readback in
  // a later task instead of reporting a false failure immediately.
  markField(el, 'review');
  window.setTimeout(() => {
    const deferredVerified = dialogValueMatches(el, value);
    markField(el, deferredVerified
      ? (confidence === 'high' ? 'verified' : 'review')
      : 'mismatch');
  }, 350);
  return true;
}

async function fillElementAsync(
  el: HTMLElement,
  value: string,
  confidence: 'high' | 'medium' | 'low' = 'medium',
): Promise<boolean> {
  const field = extractField(el);
  if (field.protected) return false;
  if (isSupportedDatePicker(el)) return fillDatePicker(el as HTMLInputElement, value, confidence);
  if (isSupportedDialogSelection(el)) return fillDialogSelection(el, value, confidence);
  const immediate = fillElement(el, value, confidence);
  if (immediate) return true;
  const verified = await waitForElementValue(el, value);
  markField(el, verified ? (confidence === 'high' ? 'verified' : 'review') : 'mismatch');
  return verified;
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

function focusAgentTarget(pageKey: string, targetId: string): boolean {
  if (getPageMeta().signature !== pageKey) return false;
  const latestFields = scanFields();
  const target = latestFields.find((result) => (
    stableTargetId(pageKey, { ...result.field, index: result.index }) === targetId
  ));
  return target ? focusField(target.index) : false;
}

async function executeAgentActions(
  pageKey: string,
  items: AgentExecutionItem[],
): Promise<AgentExecutionResult[]> {
  const pageMeta = getPageMeta();
  if (pageMeta.signature !== pageKey) {
    return items.map((item) => ({
      actionId: item.actionId,
      targetId: item.targetId,
      attempted: false,
      observed: '',
      matched: false,
      reason: 'page-changed',
    }));
  }

  const latestFields = scanFields();
  const targetElements = new Map<string, { index: number; element: HTMLElement }>();
  for (const result of latestFields) {
    const targetId = stableTargetId(pageKey, { ...result.field, index: result.index });
    const element = elementMap.get(result.index);
    if (element) targetElements.set(targetId, { index: result.index, element });
  }

  const results: AgentExecutionResult[] = [];
  for (const item of items) {
    const target = targetElements.get(item.targetId);
    if (!target) {
      results.push({
        actionId: item.actionId,
        targetId: item.targetId,
        attempted: false,
        observed: '',
        matched: false,
        reason: 'target-not-found',
      });
      continue;
    }
    const current = normalizeText(getCurrentValue(target.element));
    if (current !== normalizeText(item.expectedCurrentValue)) {
      results.push({
        actionId: item.actionId,
        targetId: item.targetId,
        attempted: false,
        observed: current,
        matched: false,
        reason: 'manual-value-changed',
      });
      continue;
    }
    if (protectedIndices.has(target.index)) {
      results.push({
        actionId: item.actionId,
        targetId: item.targetId,
        attempted: false,
        observed: current,
        matched: false,
        reason: 'protected-target',
      });
      continue;
    }
    const attempted = await fillElementAsync(target.element, item.value, item.confidence);
    const observed = normalizeText(getCurrentValue(target.element));
    const matched = attempted && valueMatches(target.element, item.value);
    results.push({
      actionId: item.actionId,
      targetId: item.targetId,
      attempted: true,
      observed,
      matched,
      reason: matched ? 'verified' : 'write-readback-mismatch',
    });
  }
  return results;
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
          waitForVisibleEditableSurface()
            .then(() => sendResponse(scanFields()))
            .catch(() => sendResponse(scanFields()));
        } else if (message.type === 'observeRepeatGroups') {
          sendResponse(observeRepeatGroups());
        } else if (message.type === 'commitRepeatRecord') {
          commitRepeatRecord(message.groupLabel)
            .then(sendResponse)
            .catch(() => sendResponse({
              groupLabel: message.groupLabel,
              committed: false,
              reason: 'unexpected-record-commit-error',
            } satisfies CommitRepeatRecordResult));
        } else if (message.type === 'getAgentPageContext') {
          sendResponse(getAgentPageContext());
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
        } else if (message.type === 'returnToPreviousStep') {
          returnToPreviousStep()
            .then(sendResponse)
            .catch(() => sendResponse({ clicked: false, advanced: false, reason: '无法安全返回上一页' }));
        } else if (message.type === 'markPreview') {
          sendResponse({ ok: true, marked: markPreviewFields(message.items) });
        } else if (message.type === 'focusField') {
          sendResponse({ ok: focusField(message.index) });
        } else if (message.type === 'focusAgentTarget') {
          sendResponse({ ok: focusAgentTarget(message.pageKey, message.targetId) });
        } else if (message.type === 'getExistingMaterialPreview') {
          getExistingMaterialPreview(message.index).then(sendResponse).catch(() => sendResponse({
            ok: false,
            dataUrl: '',
            mimeType: '',
            evidence: '',
            error: '无法读取网页现有材料',
          }));
        } else if (message.type === 'fill') {
          fillFields(message.items).then(sendResponse).catch(() => sendResponse({ success: 0, failure: message.items.length }));
        } else if (message.type === 'executeAgentActions') {
          executeAgentActions(message.pageKey, message.items)
            .then(sendResponse)
            .catch(() => sendResponse(message.items.map((item) => ({
              actionId: item.actionId,
              targetId: item.targetId,
              attempted: false,
              observed: '',
              matched: false,
              reason: 'unexpected-execution-error',
            }))));
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
            .then((success) => {
              const element = elementMap.get(message.index);
              const liveElement = element ? resolveLiveControl(element) : undefined;
              sendResponse({
                ok: success,
                observed: element ? getCurrentValue(element) : '',
                matched: element ? dialogValueMatches(element, message.value) : false,
                connected: element?.isConnected ?? false,
                rebound: Boolean(element && liveElement && element !== liveElement),
                rawValue: liveElement instanceof HTMLInputElement || liveElement instanceof HTMLTextAreaElement
                  ? liveElement.value
                  : '',
                cascaderTrace: [...lastCascaderTrace],
              });
            })
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
