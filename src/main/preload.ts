import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, AppSettings, GenerateRequest, InstallServiceResult } from '../shared/types';

contextBridge.exposeInMainWorld('electronAPI', {
  getClipboardText: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_TEXT),

  generateText: (request: GenerateRequest): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.GENERATE_TEXT, request),

  generateTextStream: (
    request: GenerateRequest,
    onChunk: (delta: string) => void
  ): Promise<string> => {
    const listener = (_event: unknown, delta: string) => onChunk(delta);
    ipcRenderer.on(IPC_CHANNELS.GENERATE_STREAM_CHUNK, listener);
    return ipcRenderer
      .invoke(IPC_CHANNELS.GENERATE_TEXT_STREAM, request)
      .finally(() => {
        ipcRenderer.removeListener(IPC_CHANNELS.GENERATE_STREAM_CHUNK, listener);
      });
  },

  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),

  saveSettings: (settings: AppSettings): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_SETTINGS, settings),

  pasteResult: (text: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PASTE_RESULT, text),

  hideWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.HIDE_WINDOW);
  },

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),

  fetchJiraActivity: (): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.FETCH_JIRA_ACTIVITY),

  fetchGitHubActivity: (): Promise<any> =>
    ipcRenderer.invoke(IPC_CHANNELS.FETCH_GITHUB_ACTIVITY),

  installRephraseService: (): Promise<InstallServiceResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.INSTALL_REPHRASE_SERVICE),
});

ipcRenderer.on('selected-text', (_event, text: string, editable: boolean) => {
  window.postMessage({ channel: 'selected-text', text, editable }, '*');
});
