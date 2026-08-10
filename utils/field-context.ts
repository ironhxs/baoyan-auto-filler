function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function chooseNearestAncestorQuestionContext(
  levels: string[][],
  maxLength = 600,
): string {
  for (const level of levels) {
    const texts = [...new Set(level.map(normalize).filter(Boolean))];
    if (texts.length === 0) continue;
    return texts.join(' ').slice(0, maxLength).trim();
  }
  return '';
}
