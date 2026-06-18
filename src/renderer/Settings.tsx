import React, { useState } from 'react';
import { AIProvider, AppSettings, PROVIDERS, ProviderInfo, Theme, ToneId } from '../shared/types';
import { TONES } from '../tools/rephrase';
import { DEFAULT_PROMPT_REFINER_PROMPT } from '../tools/prompt-refiner';
import { CloseGlyph } from './icons';

const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
];

// Claude Code accepts these durable aliases (or an empty value for the CLI
// default). A dropdown avoids the model_not_found errors that free-text display
// names like "Opus 4.8" caused.
const CLAUDE_CODE_MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Default (CLI default)' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

interface SettingsProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBack: () => void;
  onClose: () => void;
}

function getApiKeyField(provider: AIProvider): keyof AppSettings {
  switch (provider) {
    case 'openai': return 'openaiApiKey';
    case 'anthropic': return 'anthropicApiKey';
    default: return 'openaiApiKey';
  }
}

function getModelField(provider: AIProvider): keyof AppSettings {
  switch (provider) {
    case 'openai': return 'openaiModel';
    case 'anthropic': return 'anthropicModel';
    default: return 'openaiModel';
  }
}

function ProviderCard({
  info,
  apiKey,
  model,
  isActive,
  onActivate,
  onKeyChange,
  onModelChange,
  onConnect,
}: {
  info: ProviderInfo;
  apiKey: string;
  model: string;
  isActive: boolean;
  onActivate: () => void;
  onKeyChange: (key: string) => void;
  onModelChange: (model: string) => void;
  onConnect: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const isConnected = apiKey.length > 0;

  return (
    <div className={`provider-card ${isActive ? 'active' : ''}`}>
      <div className="provider-header">
        <div className="provider-name-row">
          <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          <span className="provider-name">{info.name}</span>
        </div>
        <div className="provider-status">
          {isConnected ? (
            <span className="status-text connected">Connected</span>
          ) : (
            <span className="status-text disconnected">Not configured</span>
          )}
        </div>
      </div>

      <div className="provider-body">
        <div className="key-row">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onKeyChange(e.target.value)}
            placeholder={info.keyPlaceholder}
            className="key-input"
          />
          <button
            className="icon-btn small"
            onClick={() => setShowKey(!showKey)}
            title={showKey ? 'Hide' : 'Show'}
          >
            {showKey ? '🙈' : '👁'}
          </button>
        </div>

        <div className="model-row">
          <label>Model:</label>
          <input
            type="text"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder={info.defaultModel}
            className="model-input"
          />
        </div>
      </div>

      <div className="provider-actions">
        <button className="btn btn-connect" onClick={onConnect}>
          {isConnected ? 'Get New Key' : `Connect to ${info.name}`}
        </button>
        {!isActive && (
          <button className="btn btn-use" onClick={onActivate}>
            Use {info.name}
          </button>
        )}
        {isActive && <span className="active-badge">Active</span>}
      </div>
    </div>
  );
}

export default function Settings({ settings, onSave, onBack, onClose }: SettingsProps) {
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [saved, setSaved] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [serviceStatus, setServiceStatus] = useState<string>('');
  const [installing, setInstalling] = useState(false);

  const isMac = navigator.platform.toLowerCase().includes('mac');

  const handleInstallService = async () => {
    setInstalling(true);
    setServiceStatus('');
    try {
      const result = await window.electronAPI.installRephraseService();
      setServiceStatus(result.message);
    } catch (err: any) {
      setServiceStatus(err?.message || "Couldn't install the right-click menu.");
    } finally {
      setInstalling(false);
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleKeyChange = (provider: AIProvider, key: string) => {
    const field = getApiKeyField(provider);
    setForm((prev) => ({ ...prev, [field]: key }));
    setSaved(false);
  };

  const handleModelChange = (provider: AIProvider, model: string) => {
    const field = getModelField(provider);
    setForm((prev) => ({ ...prev, [field]: model }));
    setSaved(false);
  };

  const handleActivate = (provider: AIProvider) => {
    setForm((prev) => ({ ...prev, provider }));
    setSaved(false);
  };

  const handleConnect = (info: ProviderInfo) => {
    window.electronAPI.openExternal(info.dashboardUrl);
  };

  const handleTonePromptChange = (toneId: ToneId, value: string) => {
    setForm((prev) => ({
      ...prev,
      tonePrompts: { ...prev.tonePrompts, [toneId]: value },
    }));
    setSaved(false);
  };

  const handleSave = () => {
    onSave(form);
    setSaved(true);
  };

  return (
    <div className="surface settings">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} title="Back" aria-label="Back">←</button>
        <span className="topbar-title">Settings</span>
        <span className="topbar-spacer" />
        <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <CloseGlyph />
        </button>
      </div>

      <div className="settings-content">
        <div className="section-label">AI Providers</div>

        {PROVIDERS.map((info) => (
          <ProviderCard
            key={info.id}
            info={info}
            apiKey={form[getApiKeyField(info.id)] as string}
            model={form[getModelField(info.id)] as string}
            isActive={form.provider === info.id}
            onActivate={() => handleActivate(info.id)}
            onKeyChange={(key) => handleKeyChange(info.id, key)}
            onModelChange={(model) => handleModelChange(info.id, model)}
            onConnect={() => handleConnect(info)}
          />
        ))}

        <div className="section-label">Local Providers</div>

        {/* Claude Code */}
        <div className={`provider-card ${form.provider === 'claude-code' ? 'active' : ''}`}>
          <div className="provider-header">
            <div className="provider-name-row">
              <span className={`status-dot connected`} />
              <span className="provider-name">Claude Code</span>
            </div>
            <div className="provider-status">
              <span className="status-text connected">CLI</span>
            </div>
          </div>
          <div className="provider-body">
            <div className="model-row">
              <label>Path:</label>
              <input
                type="text"
                value={form.claudeCodePath}
                onChange={(e) => { setForm((prev) => ({ ...prev, claudeCodePath: e.target.value })); setSaved(false); }}
                placeholder="claude"
                className="model-input"
              />
            </div>
            <span className="hint">Path to the claude CLI binary (default: claude)</span>
            <div className="model-row">
              <label>Model:</label>
              <select
                value={form.claudeCodeModel}
                onChange={(e) => { setForm((prev) => ({ ...prev, claudeCodeModel: e.target.value })); setSaved(false); }}
                className="model-input"
              >
                {!CLAUDE_CODE_MODELS.some((m) => m.value === form.claudeCodeModel) && (
                  <option value={form.claudeCodeModel}>{form.claudeCodeModel} (custom)</option>
                )}
                {CLAUDE_CODE_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <span className="hint">Opus is most capable; Haiku is fastest. “Default” uses the CLI's configured model.</span>
          </div>
          <div className="provider-actions">
            {form.provider !== 'claude-code' ? (
              <button className="btn btn-use" onClick={() => handleActivate('claude-code')}>
                Use Claude Code
              </button>
            ) : (
              <span className="active-badge">Active</span>
            )}
          </div>
        </div>

        {/* Cursor */}
        <div className={`provider-card ${form.provider === 'cursor' ? 'active' : ''}`}>
          <div className="provider-header">
            <div className="provider-name-row">
              <span className={`status-dot ${form.cursorEndpoint ? 'connected' : 'disconnected'}`} />
              <span className="provider-name">Cursor</span>
            </div>
            <div className="provider-status">
              {form.cursorEndpoint ? (
                <span className="status-text connected">Configured</span>
              ) : (
                <span className="status-text disconnected">Not configured</span>
              )}
            </div>
          </div>
          <div className="provider-body">
            <div className="model-row">
              <label>Endpoint:</label>
              <input
                type="text"
                value={form.cursorEndpoint}
                onChange={(e) => { setForm((prev) => ({ ...prev, cursorEndpoint: e.target.value })); setSaved(false); }}
                placeholder="http://localhost:1234/v1"
                className="model-input"
              />
            </div>
            <div className="key-row">
              <input
                type="password"
                value={form.cursorApiKey}
                onChange={(e) => { setForm((prev) => ({ ...prev, cursorApiKey: e.target.value })); setSaved(false); }}
                placeholder="API key (optional)"
                className="key-input"
              />
            </div>
            <div className="model-row">
              <label>Model:</label>
              <input
                type="text"
                value={form.cursorModel}
                onChange={(e) => { setForm((prev) => ({ ...prev, cursorModel: e.target.value })); setSaved(false); }}
                placeholder="cursor-small"
                className="model-input"
              />
            </div>
          </div>
          <div className="provider-actions">
            {form.provider !== 'cursor' ? (
              <button className="btn btn-use" onClick={() => handleActivate('cursor')}>
                Use Cursor
              </button>
            ) : (
              <span className="active-badge">Active</span>
            )}
          </div>
        </div>

        <div
          className="section-label collapsible"
          onClick={() => toggleSection('integrations')}
        >
          Integrations {expandedSections['integrations'] ? '▾' : '▸'}
        </div>

        {expandedSections['integrations'] && (
          <div className="integration-section">
            <div className="integration-card">
              <div className="integration-name">JIRA</div>
              <div className="form-group">
                <label>Base URL</label>
                <input
                  type="text"
                  value={form.jiraBaseUrl}
                  onChange={(e) => { setForm((prev) => ({ ...prev, jiraBaseUrl: e.target.value })); setSaved(false); }}
                  placeholder="https://your-org.atlassian.net"
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="text"
                  value={form.jiraEmail}
                  onChange={(e) => { setForm((prev) => ({ ...prev, jiraEmail: e.target.value })); setSaved(false); }}
                  placeholder="you@company.com"
                />
              </div>
              <div className="form-group">
                <label>API Token</label>
                <input
                  type="password"
                  value={form.jiraApiToken}
                  onChange={(e) => { setForm((prev) => ({ ...prev, jiraApiToken: e.target.value })); setSaved(false); }}
                  placeholder="JIRA API token"
                />
              </div>
            </div>

            <div className="integration-card">
              <div className="integration-name">GitHub</div>
              <div className="form-group">
                <label>Personal Access Token</label>
                <input
                  type="password"
                  value={form.githubToken}
                  onChange={(e) => { setForm((prev) => ({ ...prev, githubToken: e.target.value })); setSaved(false); }}
                  placeholder="ghp_..."
                />
              </div>
            </div>
          </div>
        )}

        <div
          className="section-label collapsible"
          onClick={() => toggleSection('tonePrompts')}
        >
          Rephrase Prompts {expandedSections['tonePrompts'] ? '▾' : '▸'}
        </div>

        {expandedSections['tonePrompts'] && (
          <div className="tone-prompts-section">
            {TONES.map((tone) => (
              <div key={tone.id} className="form-group">
                <label>{tone.emoji} {tone.label} Prompt</label>
                <textarea
                  value={form.tonePrompts[tone.id]}
                  onChange={(e) => handleTonePromptChange(tone.id, e.target.value)}
                  placeholder={tone.defaultPrompt}
                  rows={4}
                  className="prompt-textarea"
                />
                <span className="hint">Leave empty to use the default prompt</span>
              </div>
            ))}
          </div>
        )}

        <div
          className="section-label collapsible"
          onClick={() => toggleSection('promptRefiner')}
        >
          Prompt Refiner Prompt {expandedSections['promptRefiner'] ? '▾' : '▸'}
        </div>

        {expandedSections['promptRefiner'] && (
          <div className="tone-prompts-section">
            <div className="form-group">
              <label>🛠️ Prompt Refiner Instructions</label>
              <textarea
                value={form.promptRefinerPrompt}
                onChange={(e) => { setForm((prev) => ({ ...prev, promptRefinerPrompt: e.target.value })); setSaved(false); }}
                placeholder={DEFAULT_PROMPT_REFINER_PROMPT}
                rows={8}
                className="prompt-textarea"
              />
              <span className="hint">Leave empty to use the default prompt</span>
            </div>
          </div>
        )}

        <div className="section-label">General</div>

        <div className="form-group">
          <label>Theme</label>
          <div className="theme-options" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={form.theme === opt.id}
                className={`theme-option ${form.theme === opt.id ? 'selected' : ''}`}
                onClick={() => { setForm((prev) => ({ ...prev, theme: opt.id })); setSaved(false); }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {isMac && (
          <div className="integration-card">
            <div className="integration-name">Right-click Rephrase</div>
            <div className="form-group">
              <label>Default tone</label>
              <div className="theme-options" role="radiogroup" aria-label="Default rephrase tone">
                {TONES.map((tone) => (
                  <button
                    key={tone.id}
                    type="button"
                    role="radio"
                    aria-checked={form.defaultRephraseTone === tone.id}
                    className={`theme-option ${form.defaultRephraseTone === tone.id ? 'selected' : ''}`}
                    onClick={() => { setForm((prev) => ({ ...prev, defaultRephraseTone: tone.id })); setSaved(false); }}
                  >
                    {tone.emoji} {tone.label}
                  </button>
                ))}
              </div>
              <span className="hint">
                Adds “Rephrase with AIBuddy” to the right-click → Services menu, so you can
                rephrase a selection in place in any app. Save settings to apply tone changes.
              </span>
            </div>
            <button className="btn btn-ghost" onClick={handleInstallService} disabled={installing}>
              {installing ? 'Installing…' : 'Add to right-click menu'}
            </button>
            {serviceStatus && <span className="hint service-status">{serviceStatus}</span>}
          </div>
        )}

        <div
          className="toggle-row"
          onClick={() => { setForm((prev) => ({ ...prev, autoPaste: !prev.autoPaste })); setSaved(false); }}
          role="switch"
          aria-checked={form.autoPaste}
        >
          <div className="toggle-text">
            <span className="toggle-title">Auto-paste results</span>
            <span className="toggle-desc">Skip the review step — paste straight into your app</span>
          </div>
          <div className={`switch ${form.autoPaste ? 'on' : ''}`}>
            <span className="knob" />
          </div>
        </div>

        <div className="form-group">
          <label>Global Shortcut</label>
          <input
            type="text"
            value={form.globalShortcut}
            onChange={(e) => setForm((prev) => ({ ...prev, globalShortcut: e.target.value }))}
            placeholder="CommandOrControl+Shift+K"
          />
          <span className="hint">Restart app after changing shortcut</span>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave}>
            Save Settings
          </button>
          {saved && <span className="saved-indicator">Saved!</span>}
        </div>
      </div>
    </div>
  );
}
