export interface PageIdentityInput {
  url?: string;
  label?: string;
  signature?: string;
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function canonicalPageUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function semanticPageKey(input: PageIdentityInput): string {
  const base = canonicalPageUrl(input.url);
  if (!base) return '';
  const identity = input.signature
    ? [input.url, input.signature].filter(Boolean).join('\n')
    : [input.url, input.label].filter(Boolean).join('\n');
  return `${base}::${stableHash(identity || base)}`;
}
