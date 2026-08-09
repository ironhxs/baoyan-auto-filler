function chineseMonthNumber(value: string): number | null {
  const digits: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
    七: 7, 八: 8, 九: 9, 十: 10,
  };
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (digits[value.slice(1)] ?? 0);
  return digits[value] ?? null;
}

function normalizeComparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/中国共产党/g, '中共')
    .replace(/通迅/g, '通讯')
    .replace(/(20\d{2})年(十[一二]?|[一二三四五六七八九])月/g, (_all, year: string, month: string) => {
      const parsed = chineseMonthNumber(month);
      return parsed == null ? _all : `${year}${String(parsed).padStart(2, '0')}`;
    })
    .replace(/(20\d{2})年(\d{1,2})月(\d{1,2})日/g, (_all, year: string, month: string, day: string) => (
      `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`
    ))
    .replace(/(20\d{2})年(\d{1,2})月/g, (_all, year: string, month: string) => (
      `${year}${month.padStart(2, '0')}`
    ))
    .replace(/[年月日]/g, '')
    .replace(/\s+/g, '')
    .replace(/[\-_/|｜.,，。:：;；（）()【】\[\]]/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isPageValueConsistent(
  pageValue: string | undefined,
  profileValue: string | undefined,
  allowSystemPrefix = false,
): boolean {
  const actual = normalizeComparable(pageValue ?? '');
  const expected = normalizeComparable(profileValue ?? '');
  if (!actual || !expected) return false;
  if (actual === expected) return true;

  if (/[*＊•·]+/.test(actual)) {
    const pattern = actual
      .split(/[*＊•·]+/)
      .map(escapeRegExp)
      .join('.*');
    return new RegExp(`^${pattern}$`, 'i').test(expected);
  }

  if (allowSystemPrefix) {
    return actual.endsWith(expected) || expected.endsWith(actual);
  }
  return false;
}
