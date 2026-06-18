import { AppSettings, GenerateRequest, InstallServiceResult } from './types';
import { JiraActivity } from './data-sources/jira';
import { GitHubActivity } from './data-sources/github';

export interface ElectronAPI {
  getClipboardText: () => Promise<string>;
  generateText: (request: GenerateRequest) => Promise<string>;
  generateTextStream: (
    request: GenerateRequest,
    onChunk: (delta: string) => void
  ) => Promise<string>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  pasteResult: (text: string) => Promise<void>;
  hideWindow: () => void;
  openExternal: (url: string) => Promise<void>;
  fetchJiraActivity: () => Promise<JiraActivity>;
  fetchGitHubActivity: () => Promise<GitHubActivity>;
  installRephraseService: () => Promise<InstallServiceResult>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
