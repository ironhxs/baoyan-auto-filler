import type { FormFieldInfo } from './matcher';

function compact(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:，,。；;（）()【】\[\]_*#|｜]/g, '');
}

/**
 * Stable semantic identity for a page field. It intentionally avoids the
 * current value and DOM position so markers can be restored after navigation
 * even when a site reorders controls or inserts validation messages.
 */
export function fieldFingerprint(field: FormFieldInfo): string {
  const semantic = field.columnLabel
    || field.label
    || field.ariaLabel
    || field.placeholder
    || field.title
    || field.hint;
  return [
    field.kind ?? 'text',
    field.tag,
    field.type,
    compact(field.groupLabel),
    field.rowIndex ?? '',
    compact(semantic),
    compact(field.name),
    compact(field.id),
  ].join('::');
}
