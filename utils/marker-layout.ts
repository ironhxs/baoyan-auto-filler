export function findRepeatableQuestionCell(fieldElement: HTMLElement): HTMLElement | null {
  const nestedTable = fieldElement.closest('table, .adv-vxe-table, [role="grid"]');
  if (!(nestedTable instanceof HTMLElement)) return null;
  const questionCell = nestedTable.closest<HTMLElement>('td,th');
  if (!questionCell || questionCell === fieldElement.closest('td,th')) return null;
  return questionCell;
}

export function alignRepeatableQuestionCell(cell: HTMLElement): void {
  if (cell.style.verticalAlign === 'top') return;
  if (!cell.hasAttribute('data-baotian-original-vertical-align')) {
    cell.setAttribute('data-baotian-original-vertical-align', cell.style.verticalAlign);
  }
  cell.style.verticalAlign = 'top';
  cell.setAttribute('data-baotian-layout-adjusted', 'true');
}

export function restoreRepeatableQuestionCell(cell: HTMLElement): void {
  if (!cell.hasAttribute('data-baotian-layout-adjusted')) return;
  cell.style.verticalAlign = cell.getAttribute('data-baotian-original-vertical-align') ?? '';
  cell.removeAttribute('data-baotian-original-vertical-align');
  cell.removeAttribute('data-baotian-layout-adjusted');
}
