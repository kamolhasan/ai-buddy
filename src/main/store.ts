import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';
import { AppSettings, DEFAULT_SETTINGS } from '../shared/types';

const SETTINGS_FILE = 'settings.json';

const SECRET_FIELDS: (keyof AppSettings)[] = [
  'openaiApiKey',
  'anthropicApiKey',
  'cursorApiKey',
  'jiraApiToken',
  'githubToken',
];

function getSettingsPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, SETTINGS_FILE);
}

const SERVICE_ENDPOINT_FILE = 'service-endpoint';

export function serviceEndpointPath(): string {
  return path.join(app.getPath('userData'), SERVICE_ENDPOINT_FILE);
}

// The macOS Quick Action reads this file to discover where to reach the local
// rephrase server. Two lines — "<port>\n<token>" — so a shell script can parse
// it without jq/python. Written 0600 since the token guards the endpoint.
export function writeServiceEndpoint(port: number, token: string): void {
  const filePath = serviceEndpointPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, `${port}\n${token}\n`, { encoding: 'utf-8', mode: 0o600 });
}

// The app was renamed DevBuddy -> AIBuddy, which moves Electron's userData
// folder. Copy a pre-rename settings file into the new location once so users
// keep their saved provider config and (keychain-encrypted) API keys.
const LEGACY_APP_NAME = 'DevBuddy';

function migrateLegacySettings(): void {
  const newPath = getSettingsPath();
  if (fs.existsSync(newPath)) return;

  const legacyPath = path.join(
    path.dirname(app.getPath('userData')),
    LEGACY_APP_NAME,
    SETTINGS_FILE
  );
  if (!fs.existsSync(legacyPath)) return;

  try {
    const dir = path.dirname(newPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(legacyPath, newPath);
    fs.chmodSync(newPath, 0o600);
  } catch {
    // Migration is best-effort; fall back to defaults if the copy fails.
  }
}

function encryptValue(plaintext: string): string {
  if (!plaintext) return '';
  if (!safeStorage.isEncryptionAvailable()) return plaintext;
  const encrypted = safeStorage.encryptString(plaintext);
  return encrypted.toString('hex');
}

function decryptValue(hex: string): string {
  if (!hex) return '';
  if (!safeStorage.isEncryptionAvailable()) return hex;
  try {
    const buffer = Buffer.from(hex, 'hex');
    return safeStorage.decryptString(buffer);
  } catch {
    // Decryption failed — value might be plaintext from before migration.
    // Return as-is so the user doesn't lose their key; it will be re-encrypted on next save.
    return hex;
  }
}

export function loadSettings(): AppSettings {
  try {
    migrateLegacySettings();
    const filePath = getSettingsPath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const stored = JSON.parse(data);

      // Decrypt secret fields
      for (const field of SECRET_FIELDS) {
        if (stored[field]) {
          stored[field] = decryptValue(stored[field]);
        }
      }

      return { ...DEFAULT_SETTINGS, ...stored };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: AppSettings): void {
  const filePath = getSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Clone and encrypt secret fields before writing
  const toStore = { ...settings };
  for (const field of SECRET_FIELDS) {
    if (toStore[field]) {
      (toStore as any)[field] = encryptValue(toStore[field] as string);
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(toStore, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}
