export type ApiMode = 'chat_completions' | 'responses';

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
  apiMode: ApiMode;
  fastMode: boolean;
  aiEnhanced: boolean;
}

const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  providerId: '',
  apiMode: 'chat_completions',
  fastMode: false,
  aiEnhanced: true,
};

export function getApiConfig(): Promise<ApiConfig> {
  return chrome.storage.local.get('apiConfig').then((result) => ({
    ...DEFAULT_API_CONFIG,
    ...(result.apiConfig as Partial<ApiConfig> || {}),
  }));
}

export function setApiConfig(config: Partial<ApiConfig>): Promise<void> {
  return getApiConfig().then((current) =>
    chrome.storage.local.set({ apiConfig: { ...current, ...config } }),
  );
}

export function isApiConfigured(): Promise<boolean> {
  return getApiConfig().then((cfg) => (
    cfg.baseUrl.trim().length > 0 &&
    cfg.apiKey.trim().length > 0 &&
    cfg.model.trim().length > 0
  ));
}
