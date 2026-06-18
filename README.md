# AIBuddy

A system-tray app that rewrites your text in different tones using AI. Works in **Slack desktop**, Slack web, and any application with a text field. AIBuddy is run from source (it is not distributed as a signed/notarized installer).

## How It Works

1. Select text in any app (Slack, email, browser, etc.)
2. Press `⌘⇧K` (Mac) or `Ctrl+Shift+K` (Windows/Linux)
3. A single command palette appears with your selection captured at the top
4. Type to fuzzy-search any action (e.g. "friendly", "summarize", "standup"), then press `↵` — or use the inline `⌘1…9` shortcuts
5. The result streams in live; press `↵` to Apply & Paste, `⌘C` to copy, or `⌘R` to regenerate

Everything happens on one keyboard-first surface — no menu drilling. Turn on **Auto-paste** in Settings to skip the review step entirely. The global shortcut is configurable in Settings.

## Rephrase from the right-click menu (macOS)

On macOS you can rephrase a selection in place without opening the palette:

1. In Settings, click **Add to right-click menu** (also available from the tray menu as **Add Right-Click Rephrase…**). This installs a "Rephrase with AIBuddy" macOS Service.
2. Select text in any app, right-click, and choose **Services → Rephrase with AIBuddy**.
3. A small "Rephrasing…" popover appears next to your text; the rephrased result is pasted in place when it's ready.

The tone used is the **Default rephrase tone** set in Settings. Because the result is pasted with ⌘V, this uses the same Accessibility/Automation permissions as the palette (see below).

Notes:
- If it doesn't appear, enable it once under **System Settings → Keyboard → Keyboard Shortcuts → Services → Text**, then re-open the target app.
- **Slack:** plain text rephrases fine. A selection that contains a Slack **@mention** can't be rephrased (Slack doesn't expose mention "pills" as text) — AIBuddy safely leaves the text untouched rather than altering it.
- Only plain-text structure is preserved (line breaks, bullets, numbered lists, indentation, markdown markers). True rich formatting (e.g. real bold in Google Docs) can't survive the plain-text channel.

## Actions

Actions are organized into three groups. In the palette, the first few are reachable via `⌘1…9` quick-select.

### Rephrase

Rewrites your selected text while preserving its meaning and original language.

- **Professional** — polished, business-appropriate wording; drops slang and casual phrasing.
- **Friendly** — warm, conversational, and approachable tone.
- **Direct** — concise and to the point; strips hedging and filler.

### Generate

Creates new text for you.

- **Ask** — ask anything in plain English and get a direct answer; any selected text is used as context.
- **Activity Notes** — drafts a standup update or shift/call handoff from your recent JIRA and GitHub activity.

### Tools

Transform or analyze the text you selected.

- **Summarize** — condenses the selection into a short TL;DR.
- **Review Polish** — rewrites code-review feedback to be constructive and actionable.
- **Prompt Refiner** — fills in missing pieces and optimizes a prompt for an AI agent.
- **Explain Error** — finds the likely root cause and fix for an error or stack trace.

## Getting Started

The recommended (and only supported) way to run AIBuddy is from source.

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Git](https://git-scm.com/)
- One AI provider: an API key from **OpenAI** or **Anthropic**, the **Claude Code** CLI (`claude`) installed locally, or a **Cursor**/OpenAI-compatible endpoint

### Clone & Run

```bash
git clone https://github.com/kamolhasan/ai-buddy.git
cd ai-buddy
npm install
npm run build
npm start
```

AIBuddy launches into the menu bar / system tray — there is no main window until you press the shortcut or pick **Show AIBuddy** from the tray.

### Configuration

On first launch, click the tray icon → Settings to configure:
- AI Provider (OpenAI, Anthropic, Claude Code, or Cursor) and its API key
- Model selection (the Claude Code model is a dropdown: Default / Opus / Sonnet / Haiku)
- Custom global keyboard shortcut (default `⌘⇧K` / `Ctrl+Shift+K`)
- Theme (Dark / Light / System)
- Default rephrase tone (used by the right-click menu)
- **Add to right-click menu** — installs the macOS "Rephrase with AIBuddy" Service

### macOS Permissions

AIBuddy needs **two** macOS permissions to read your selection and paste results.

Important: when you run from source, macOS grants these permissions to the **app that launches the process** — the Terminal or IDE you ran `npm start` from (e.g. **Terminal**, **iTerm**, **VS Code**, or **Cursor**), not to "AIBuddy" or "Electron". Grant the permissions to that launcher app:

1. **Accessibility** — System Settings → Privacy & Security → Accessibility → enable your Terminal/IDE.
2. **Automation** — System Settings → Privacy & Security → Automation → your Terminal/IDE → enable "System Events".

Granting Accessibility alone is not enough; without Automation, macOS silently blocks the copy/paste and the palette will open with no selected text. After changing either permission, fully quit and reopen the Terminal/IDE (and AIBuddy). If you later launch AIBuddy from a different terminal or IDE, you'll need to grant the permissions to that app too. You can re-open these panes anytime from the tray icon → **Permissions Help**.

## Development

```bash
# Watch mode (rebuilds on changes)
npm run dev

# In another terminal, run Electron
npx electron dist/main.js
```

## Tech Stack

- Electron (TypeScript)
- React (renderer UI)
- OpenAI SDK / Anthropic SDK
- Webpack (bundler)

## Troubleshooting

- **No window appears on launch** — that's expected. AIBuddy lives in the menu bar / system tray; click its icon, or press `⌘⇧K` (`Ctrl+Shift+K` on Windows/Linux).
- **macOS: the palette opens but no text is captured** — you're missing the **Automation** permission. Because you run from source, grant it to the **Terminal/IDE** that launched AIBuddy (not "Electron"): System Settings → Privacy & Security → Automation → your Terminal/IDE → enable "System Events" (and grant it Accessibility too), then restart the Terminal/IDE and AIBuddy. The tray → **Permissions Help** menu opens these panes for you.
- **macOS: pressing the shortcut still does nothing** — first confirm the app is running (menu-bar icon). Try the tray → **Show AIBuddy** menu item: if that also does nothing, check tray → **Open Logs** for the cause. If only the shortcut fails, it's likely a conflict — pick a different one in Settings.
- **"Failed to register shortcut"** — another app is using `⌘⇧K` / `Ctrl+Shift+K`. Pick a different shortcut in Settings.
- **Right-click "Rephrase with AIBuddy" doesn't appear** — enable it under System Settings → Keyboard → Keyboard Shortcuts → Services → Text, and re-open the target app. It also requires AIBuddy to be running.
- **Claude Code: "couldn't find the model"** — pick a valid model in Settings (the dropdown offers Opus / Sonnet / Haiku, or Default to use the CLI's configured model).
- **Actions error out or return nothing** — make sure you've set a valid API key and model in Settings. Standup/Handoff also need your JIRA and GitHub credentials.
- **Linux: API keys not saved securely** — without a system keyring, keys are stored unencrypted. Install a keyring (e.g. GNOME Keyring) for encrypted storage.

## License

[MIT](LICENSE)
