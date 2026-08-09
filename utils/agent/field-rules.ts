export interface ExtractAgentFieldRulesInput {
  texts: string[];
  explicitDateFormat?: string;
  domMaxLength?: number;
}

export interface AgentFieldRules {
  dateFormat: string;
  formatHints: string[];
  forbiddenCharacters: string[];
  maxLength?: number;
}

function normalize(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function extractAgentFieldRules(input: ExtractAgentFieldRulesInput): AgentFieldRules {
  const text = input.texts.map(normalize).filter(Boolean).join(' ');
  const explicit = normalize(input.explicitDateFormat);
  const dateExample = text.match(/(?:日期|时间)?格式[^0-9]{0,10}(\d{4}[-/.年]\d{1,2})/)?.[1] ?? '';
  const dateFormat = explicit || dateExample;
  const forbiddenCharacters = [...new Set((text.match(/(?:不得|不能|禁止)(?:含有|包含|输入|使用)?[^。；;\n]{0,50}/g) ?? [])
    .flatMap((clause) => clause.match(/[|#<>]/g) ?? []))];
  const textualLengths = [...text.matchAll(/(?:最多|不超过|限)(?:填写|输入)?\s*(\d{1,6})\s*(?:个)?(?:字|字符)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  const domMaxLength = input.domMaxLength != null
    && input.domMaxLength > 0
    && input.domMaxLength < 100_000
    ? input.domMaxLength
    : undefined;
  const lengthCandidates = [...textualLengths, ...(domMaxLength == null ? [] : [domMaxLength])];
  const maxLength = lengthCandidates.length > 0 ? Math.min(...lengthCandidates) : undefined;
  return {
    dateFormat,
    formatHints: dateFormat ? [dateFormat] : [],
    forbiddenCharacters,
    ...(maxLength == null ? {} : { maxLength }),
  };
}

export interface ObservedRepeatTableInput {
  knownGroupLabel: string;
  nearestHeading: string;
  rowEditableCounts: number[];
  columnLabels: string[];
  hasAddControl: boolean;
}

export function classifyObservedRepeatTable(input: ObservedRepeatTableInput): {
  repeatable: boolean;
  groupLabel: string;
} {
  const knownGroupLabel = normalize(input.knownGroupLabel);
  const nearestHeading = normalize(input.nearestHeading);
  const multiFieldRows = input.rowEditableCounts.filter((count) => count >= 2).length;
  const meaningfulColumns = [...new Set(input.columnLabels.map(normalize).filter(Boolean))];
  const repeatable = multiFieldRows > 0
    && meaningfulColumns.length >= 2
    && (Boolean(knownGroupLabel) || input.hasAddControl || multiFieldRows >= 2);
  return {
    repeatable,
    groupLabel: knownGroupLabel || nearestHeading || '重复资料',
  };
}

