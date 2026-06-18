import React, { useState, useEffect } from 'react';
import CommandPalette from './CommandPalette';
import Settings from './Settings';
import { AppSettings, Theme } from '../shared/types';
import '../shared/electron-api';

type View = 'palette' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('palette');
  const [selectedText, setSelectedText] = useState('');
  const [targetEditable, setTargetEditable] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'show-settings') {
        setView('settings');
      }
      if (event.data?.channel === 'selected-text') {
        setSelectedText(event.data.text || '');
        setTargetEditable(event.data.editable !== false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Reflect the chosen theme onto the document so the CSS variables switch.
  useEffect(() => {
    const theme: Theme = settings?.theme ?? 'dark';
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme;
      document.documentElement.setAttribute('data-theme', resolved);
    };
    apply();
    if (theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [settings?.theme]);

  const handleSettingsSaved = async (newSettings: AppSettings) => {
    await window.electronAPI.saveSettings(newSettings);
    setSettings(newSettings);
    setView('palette');
  };

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  if (!settings) {
    return <div className="surface boot" />;
  }

  if (view === 'settings') {
    return (
      <Settings
        settings={settings}
        onSave={handleSettingsSaved}
        onBack={() => setView('palette')}
        onClose={handleClose}
      />
    );
  }

  return (
    <CommandPalette
      selectedText={selectedText}
      targetEditable={targetEditable}
      settings={settings}
      onOpenSettings={() => setView('settings')}
      onClose={handleClose}
    />
  );
}
