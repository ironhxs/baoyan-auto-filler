export interface MaterialFieldSemanticParts {
  label?: string;
  hint?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  name?: string;
  id?: string;
  context?: string;
  html?: string;
}

function joined(values: Array<string | undefined>): string {
  return values.map((value) => value?.trim() ?? '').filter(Boolean).join(' ');
}

export function materialFieldRoleTexts(
  field: MaterialFieldSemanticParts,
  pageLabel = '',
): { direct: string; fallback: string } {
  return {
    direct: joined([
      field.label,
      field.hint,
      field.placeholder,
      field.ariaLabel,
      field.title,
      field.name,
      field.id,
    ]),
    fallback: joined([field.context, field.html, pageLabel]),
  };
}

function normalized(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function usefulDirectLabel(value: string | undefined): string {
  const text = normalized(value);
  if (!text || /^(?:file|uploadfile|upload|attachment|附件|选择文件)\d*$/i.test(text)) return '';
  return text;
}

export function materialFieldDisplayLabel(
  field: MaterialFieldSemanticParts,
  pageLabel = '',
  index = 0,
): string {
  const direct = [field.label, field.ariaLabel, field.placeholder, field.title]
    .map(usefulDirectLabel)
    .find(Boolean);
  if (direct) return direct;

  const page = normalized(pageLabel);
  if (page) {
    return /^(?:上传材料|材料上传|附件上传|证明材料|上传文件)$/.test(page)
      ? `${page}（第${index + 1}项）`
      : page;
  }
  return usefulDirectLabel(field.name) || usefulDirectLabel(field.id) || `上传项 ${index + 1}`;
}
