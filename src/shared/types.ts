export type AIProvider = 'openai' | 'anthropic' | 'claude-code' | 'cursor';

export type Theme = 'dark' | 'light' | 'system';

export type ToneId = 'professional' | 'friendly' | 'direct';

export type ToolId =
  | 'rephrase'
  | 'activity-notes'
  | 'summarizer'
  | 'review-polish'
  | 'prompt-refiner'
  | 'explain-error'
  | 'ask';

export interface TonePrompts {
  professional: string;
  friendly: string;
  direct: string;
}

export interface AppSettings {
  provider: AIProvider;
  openaiApiKey: string;
  anthropicApiKey: string;
  openaiModel: string;
  anthropicModel: string;
  claudeCodePath: string;
  claudeCodeModel: string;
  cursorEndpoint: string;
  cursorApiKey: string;
  cursorModel: string;
  globalShortcut: string;
  autoPaste: boolean;
  theme: Theme;
  defaultRephraseTone: ToneId;
  tonePrompts: TonePrompts;
  promptRefinerPrompt: string;

  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  githubToken: string;
}

export interface GenerateRequest {
  toolId: ToolId;
  systemPrompt: string;
  userContent: string;
}

export interface ProviderInfo {
  id: AIProvider;
  name: string;
  dashboardUrl: string;
  keyPlaceholder: string;
  defaultModel: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    dashboardUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    defaultModel: 'gpt-4o',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    dashboardUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    defaultModel: 'claude-sonnet-4-20250514',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  openaiModel: 'gpt-4o',
  anthropicModel: 'claude-sonnet-4-20250514',
  claudeCodePath: 'claude',
  claudeCodeModel: '',
  cursorEndpoint: '',
  cursorApiKey: '',
  cursorModel: '',
  globalShortcut: 'CommandOrControl+Shift+K',
  autoPaste: false,
  theme: 'dark',
  defaultRephraseTone: 'professional',
  tonePrompts: {
    professional: '',
    friendly: '',
    direct: '',
  },
  promptRefinerPrompt: '',

  jiraBaseUrl: '',
  jiraEmail: '',
  jiraApiToken: '',
  githubToken: '',
};

export const IPC_CHANNELS = {
  GENERATE_TEXT: 'generate-text',
  GENERATE_TEXT_STREAM: 'generate-text-stream',
  GENERATE_STREAM_CHUNK: 'generate-stream-chunk',
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  CLIPBOARD_TEXT: 'clipboard-text',
  PASTE_RESULT: 'paste-result',
  HIDE_WINDOW: 'hide-window',
  OPEN_EXTERNAL: 'open-external',
  FETCH_JIRA_ACTIVITY: 'fetch-jira-activity',
  FETCH_GITHUB_ACTIVITY: 'fetch-github-activity',
  INSTALL_REPHRASE_SERVICE: 'install-rephrase-service',
} as const;

export interface InstallServiceResult {
  ok: boolean;
  message: string;
}
