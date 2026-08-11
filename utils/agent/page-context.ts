export const AGENT_PAGE_INSTRUCTION_PATTERN = /(?:日期格式|时间格式|格式(?:如下|要求)?|不得|不能|禁止|请勿|最多|不超过|至少|必须|必填|选填|限(?:制|填)|字符|字数|年月|排名|上传|材料|说明|提示|要求)/u;
export const AGENT_PAGE_SENSITIVE_PATTERN = /(?:password|passwd|\bpwd\b|验证码|captcha|支付|payment|cookie|authorization|bearer|csrf|session(?:id|token)?|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|密钥|口令)/iu;

export function normalizeAgentPageText(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!text || text.length < 2 || text.length > 800 || AGENT_PAGE_SENSITIVE_PATTERN.test(text)) return '';
  return text;
}

export function buildAgentPageSemanticText(values: string[]): {
  visibleTexts: string[];
  instructions: string[];
} {
  const visibleTexts = [...new Set(values.map(normalizeAgentPageText).filter(Boolean))];
  return {
    visibleTexts,
    instructions: visibleTexts.filter((text) => AGENT_PAGE_INSTRUCTION_PATTERN.test(text)),
  };
}

export function isSensitiveAgentPageText(value: string): boolean {
  return AGENT_PAGE_SENSITIVE_PATTERN.test(value);
}
