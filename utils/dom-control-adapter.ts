export type DomControlKind = 'text' | 'select' | 'cascader' | 'date-picker' | 'file';

export interface DomControlProbe {
  tagName: string;
  type?: string;
  value?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  role?: string;
  classNames?: string[];
  ancestorClassNames?: string[];
  attributes?: Record<string, string | undefined>;
  labelText?: string;
  visibleSelectionText?: string;
  visibleDisplayText?: string;
  wrapperText?: string;
}

export interface DatePickerTarget {
  year: number;
  month: number;
  day?: number;
}

export interface DomControlIdentity {
  tagName: string;
  id?: string;
  name?: string;
  prop?: string;
  type?: string;
  xtype?: string;
  caption?: string;
  label?: string;
  groupLabel?: string;
  controlKind?: DomControlKind;
  fingerprint?: string;
}

export interface DomControlInteractionPlan {
  kind: DomControlKind;
}

export interface OverlaySurfaceProbe {
  display?: string;
  visibility?: string;
  opacity?: string;
  width: number;
  height: number;
  className?: string;
  candidateCount: number;
}

const PLACEHOLDER_PATTERNS = [
  /^请选择$/u,
  /^请(?:输入|选择)$/u,
  /^选择$/u,
  /^由系统自动计算$/u,
  /^--+$/u,
  /^无数据$/u,
];

const OVERLAY_SELECTORS: Record<Exclude<DomControlKind, 'text' | 'file'>, string[]> = {
  select: [
    '[role="listbox"]',
    '.el-select-dropdown',
    '.el-select-dropdown__wrap',
    '.el-select-dropdown__list',
    '.ant-select-dropdown',
    '.ant-select-item-option',
    '.vxe-pulldown--panel',
  ],
  cascader: [
    '[role="menu"]',
    '[role="menuitem"]',
    '.el-cascader-panel',
    '.el-cascader-menu',
    '.el-cascader-node',
    '.ant-cascader-menus',
    '.vxe-pulldown--panel',
  ],
  'date-picker': [
    '[role="grid"]',
    '[role="dialog"]',
    '.el-picker-panel',
    '.el-date-picker',
    '.el-date-table',
    '.el-month-table',
    '.el-year-table',
    '.ant-picker-dropdown',
    '.ant-picker-panel',
  ],
};

const OVERLAY_ROOT_SELECTORS: Record<Exclude<DomControlKind, 'text' | 'file'>, string[]> = {
  select: [
    '[role="listbox"]',
    '.el-select-dropdown',
    '.ant-select-dropdown',
    '.vxe-pulldown--panel',
  ],
  cascader: [
    '.el-cascader__dropdown',
    '.el-cascader-panel',
    '.ant-cascader-menus',
    '.vxe-pulldown--panel',
  ],
  'date-picker': [
    '.el-picker-panel',
    '.el-date-picker',
    '.ant-picker-dropdown',
  ],
};

function normalized(value: string | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function hasAvailableOverlayStyle(probe: OverlaySurfaceProbe): boolean {
  return probe.display !== 'none'
    && probe.visibility !== 'hidden'
    && probe.opacity !== '0';
}

function isEnteringOverlay(probe: OverlaySurfaceProbe): boolean {
  const className = normalized(probe.className);
  return /(?:^|\s)el-[^\s]*-enter-active(?:\s|$)/u.test(className)
    && !/(?:^|\s)el-[^\s]*-leave(?:-active)?(?:\s|$)/u.test(className);
}

export function isActionableOverlaySurface(probe: OverlaySurfaceProbe): boolean {
  if (!hasAvailableOverlayStyle(probe)) return false;
  if (probe.width > 0 && probe.height > 0) return true;
  return probe.width > 0 && probe.candidateCount > 0 && isEnteringOverlay(probe);
}

export function isActionableOverlayCandidate(
  surface: OverlaySurfaceProbe,
  candidate: OverlaySurfaceProbe,
): boolean {
  if (!isActionableOverlaySurface(surface) || !hasAvailableOverlayStyle(candidate)) return false;
  if (candidate.width > 0 && candidate.height > 0) return true;
  return candidate.width > 0 && isEnteringOverlay(surface);
}

function normalizedSelectionAlias(value: string): string {
  return normalized(value)
    .replace(/中国共产主义青年团团员/gu, '共青团员')
    .replace(/^\d{4,12}\s*/u, '')
    .replace(/中国共产党/gu, '中共')
    .replace(/中国共产主义青年团/gu, '共青团')
    .replace(/[|/>\\、,，;；\s-]+/gu, '');
}

export function selectionTextsEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizedSelectionAlias(left);
  const normalizedRight = normalizedSelectionAlias(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function pickControlIdentityCandidate(
  target: DomControlIdentity,
  candidates: DomControlIdentity[],
): number | null {
  const normalizedTag = target.tagName.toLowerCase();
  const ranked = candidates.map((candidate, index) => {
    if (candidate.tagName.toLowerCase() !== normalizedTag) return { index, score: 0 };
    let score = 1;
    if (target.type && candidate.type === target.type) score += 1;
    if (target.controlKind && candidate.controlKind === target.controlKind) score += 2;
    if (target.groupLabel && normalized(candidate.groupLabel) === normalized(target.groupLabel)) score += 3;
    if (target.xtype && normalized(candidate.xtype) === normalized(target.xtype)) score += 4;
    if (target.prop && candidate.prop === target.prop) score += 4;
    if (target.label && normalized(candidate.label) === normalized(target.label)) score += 6;
    if (target.caption && normalized(candidate.caption) === normalized(target.caption)) score += 6;
    if (target.name && candidate.name === target.name) score += 8;
    if (target.id && candidate.id === target.id) score += 16;
    if (target.fingerprint && candidate.fingerprint === target.fingerprint) score += 24;
    return { index, score };
  }).filter((candidate) => candidate.score > 1)
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].index;
}

export function stableDomControlIdentityKey(identity: DomControlIdentity): string {
  const values = [
    identity.controlKind || 'unknown',
    normalized(identity.tagName).toLowerCase(),
    identity.id ? `id=${normalized(identity.id)}` : '',
    identity.name ? `name=${normalized(identity.name)}` : '',
    identity.prop ? `prop=${normalized(identity.prop)}` : '',
    identity.xtype ? `xtype=${normalized(identity.xtype)}` : '',
    identity.caption ? `caption=${normalized(identity.caption)}` : '',
    identity.label ? `label=${normalized(identity.label)}` : '',
    identity.groupLabel ? `group=${normalized(identity.groupLabel)}` : '',
    identity.fingerprint ? `fingerprint=${normalized(identity.fingerprint)}` : '',
  ];
  return values.filter(Boolean).join('|').slice(0, 800);
}

function structuralMarkers(probe: DomControlProbe): string {
  return [
    ...(probe.classNames ?? []),
    ...(probe.ancestorClassNames ?? []),
    ...Object.values(probe.attributes ?? {}).filter(Boolean),
    probe.role ?? '',
  ].join(' ');
}

export function isPlaceholderValue(value: string | undefined, placeholder?: string): boolean {
  const text = normalized(value);
  if (!text) return true;
  const expectedPlaceholder = normalized(placeholder);
  if (expectedPlaceholder && text === expectedPlaceholder) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyDomControl(probe: DomControlProbe): DomControlKind {
  if ((probe.type ?? '').toLowerCase() === 'file') return 'file';
  const structure = structuralMarkers(probe);
  const semanticText = `${structure} ${probe.labelText ?? ''}`;
  if (
    /date-picker|date-editor|date-local|datepicker|日期|年月|时间/u.test(semanticText)
    && !/text-area|textarea/u.test(structure)
  ) return 'date-picker';
  if (/cascader|select-tree|级联|树选择/u.test(structure)) return 'cascader';
  if (
    /(?:^|[\s_-])select(?:[\s_-]|$)|res-select|combobox|listbox/u.test(structure)
    || probe.role === 'combobox'
  ) return 'select';
  return 'text';
}

export function createDomControlInteractionPlan(probe: DomControlProbe): DomControlInteractionPlan {
  return { kind: classifyDomControl(probe) };
}

export function collectDisplayValueCandidates(probe: DomControlProbe): string[] {
  const normalizedValue = normalized(probe.value);
  const kind = classifyDomControl(probe);
  const keepMirroredSelectionValue = Boolean(
    normalizedValue
      && probe.readOnly === true
      && (kind === 'select' || kind === 'cascader')
      && !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalizedValue)),
  );
  const values = [
    probe.value,
    probe.visibleSelectionText,
    probe.visibleDisplayText,
    probe.wrapperText,
  ].map(normalized).filter(Boolean);
  return [...new Set(values)].filter((value) => (
    value === normalizedValue && keepMirroredSelectionValue
  ) || !isPlaceholderValue(value, probe.placeholder));
}

export function getOverlaySelectors(kind: DomControlKind): string[] {
  if (kind === 'text' || kind === 'file') return [];
  return [...OVERLAY_SELECTORS[kind]];
}

export function getOverlayRootSelectors(kind: DomControlKind): string[] {
  if (kind === 'text' || kind === 'file') return [];
  return [...OVERLAY_ROOT_SELECTORS[kind]];
}

export function getCascaderNodeActivationSelectors(isTerminal: boolean): string[] {
  if (!isTerminal) return ['.el-cascader-node__label'];
  return [
    'label[role="radio"]',
    '.el-radio',
    '.el-radio__input',
    '.el-cascader-node__label',
  ];
}

export function parseDatePickerTarget(value: string): DatePickerTarget | null {
  const text = normalized(value);
  if (!text) return null;

  const normalizedDate = text
    .replace(/[年/.]/gu, '-')
    .replace(/月/gu, '-')
    .replace(/日/gu, '')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');

  let year: number;
  let month: number;
  let day: number | undefined;
  const compact = normalizedDate.match(/^(\d{4})(\d{2})(\d{2})?$/u);
  if (compact) {
    year = Number(compact[1]);
    month = Number(compact[2]);
    day = compact[3] ? Number(compact[3]) : undefined;
  } else {
    const separated = normalizedDate.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/u);
    if (!separated) return null;
    year = Number(separated[1]);
    month = Number(separated[2]);
    day = separated[3] ? Number(separated[3]) : undefined;
  }

  if (year < 1900 || year > 2200 || month < 1 || month > 12) return null;
  if (day !== undefined) {
    const maximumDay = new Date(year, month, 0).getDate();
    if (day < 1 || day > maximumDay) return null;
  }
  return { year, month, day };
}

export function datePickerValuesEquivalent(left: string, right: string): boolean {
  const actual = parseDatePickerTarget(left);
  const expected = parseDatePickerTarget(right);
  if (!actual || !expected) return false;
  return actual.year === expected.year
    && actual.month === expected.month
    && (actual.day === undefined || expected.day === undefined || actual.day === expected.day);
}

export function pickHierarchicalSegment(
  target: string,
  candidates: string[],
): { label: string; remaining: string } | null {
  const compactTarget = normalized(target).replace(/[>／/、,，\s]+/gu, '');
  if (!compactTarget) return null;

  const terminalMatches = candidates
    .map(normalized)
    .filter(Boolean)
    .filter((candidate) => selectionTextsEquivalent(candidate, target));
  if (terminalMatches.length === 1) {
    return { label: terminalMatches[0], remaining: '' };
  }

  const matches = candidates
    .map((candidate) => ({
      label: normalized(candidate),
      comparable: normalized(candidate).replace(/[>／/、,，\s]+/gu, ''),
    }))
    .filter(({ comparable }) => comparable && compactTarget.startsWith(comparable))
    .sort((left, right) => right.comparable.length - left.comparable.length);
  const matched = matches[0];
  if (!matched) return null;
  return {
    label: matched.label,
    remaining: compactTarget.slice(matched.comparable.length),
  };
}

export function pickCascaderExplorationLabels(target: string, candidates: string[]): string[] {
  const compactTarget = normalized(target).replace(/[>，、,\s]+/gu, '');
  const normalizedCandidates = candidates
    .map((candidate) => ({
      label: normalized(candidate),
      comparable: normalized(candidate).replace(/[>，、,\s]+/gu, ''),
    }))
    .filter((candidate) => Boolean(candidate.comparable));
  if (normalizedCandidates.some((candidate) => compactTarget.startsWith(candidate.comparable))) return [];
  return [...new Set(normalizedCandidates.map((candidate) => candidate.label))];
}
