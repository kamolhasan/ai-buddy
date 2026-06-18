import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { InstallServiceResult } from '../shared/types';

const SERVICE_NAME = 'Rephrase with AIBuddy';

function servicesDir(): string {
  return path.join(os.homedir(), 'Library', 'Services');
}

function workflowPath(): string {
  return path.join(servicesDir(), `${SERVICE_NAME}.workflow`);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The script the Quick Action runs. It just hands the selection to AIBuddy's
// /rephrase-inplace endpoint and produces NO output of its own — the workflow's
// output type is "nothing", so macOS never replaces the field (that path wipes
// Slack mentions). AIBuddy shows the popover, rephrases, and pastes the result
// over the selection with ⌘V. If the app is offline we simply do nothing.
function buildScript(endpointFile: string): string {
  return `#!/bin/bash
ENDPOINT_FILE=${JSON.stringify(endpointFile)}
INPUT="$(cat)"
if [ -z "$INPUT" ]; then exit 0; fi
PORT="$(/usr/bin/sed -n '1p' "$ENDPOINT_FILE" 2>/dev/null)"
TOKEN="$(/usr/bin/sed -n '2p' "$ENDPOINT_FILE" 2>/dev/null)"
if [ -z "$PORT" ] || [ -z "$TOKEN" ]; then exit 0; fi
printf '%s' "$INPUT" | /usr/bin/curl -sS -m 130 -H "X-AIBuddy-Token: $TOKEN" --data-binary @- "http://127.0.0.1:$PORT/rephrase-inplace" >/dev/null 2>&1
exit 0
`;
}

// Info.plist declaring the Service. It receives text (NSSendTypes) but returns
// nothing — AIBuddy pastes the result itself, so there is NO NSReturnTypes and
// macOS never replaces the field (its replace path wipes Slack @mentions).
function buildInfoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${SERVICE_NAME}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSTextContent</key>
				<string>NSStringPboardType</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array/>
			<key>NSSendTypes</key>
			<array>
				<string>NSStringPboardType</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`;
}

// A minimal Automator document for a "Run Shell Script" Quick Action. Input is
// delivered to the script on stdin; output type is "nothing" (AIBuddy does the
// paste itself), so the workflow never modifies the document.
function buildWflow(script: string): string {
  const inputUUID = crypto.randomUUID();
  const outputUUID = crypto.randomUUID();
  const actionUUID = crypto.randomUUID();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${xmlEscape(script)}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>0</integer>
					<key>shell</key>
					<string>/bin/bash</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>${inputUUID}</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>${outputUUID}</string>
				<key>UUID</key>
				<string>${actionUUID}</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict/>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:253.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleIDsByPath</key>
		<dict/>
		<key>applicationPaths</key>
		<array/>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.text</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>11</integer>
		<key>processesInput</key>
		<integer>0</integer>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.text</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>useAutomaticInputType</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;
}

function flushServicesCache(): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      '/System/Library/CoreServices/pbs',
      ['-flush'],
      { timeout: 5000 },
      () => resolve() // best-effort; ignore failures
    );
  });
}

/**
 * Write the "Rephrase with AIBuddy" Quick Action into ~/Library/Services and
 * refresh the Services cache so it shows up in the right-click → Services menu.
 */
export async function installRephraseQuickAction(endpointFile: string): Promise<InstallServiceResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, message: 'The right-click Rephrase menu is only available on macOS.' };
  }

  try {
    const bundle = workflowPath();
    const contents = path.join(bundle, 'Contents');
    fs.mkdirSync(contents, { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), buildInfoPlist(), 'utf-8');
    fs.writeFileSync(path.join(contents, 'document.wflow'), buildWflow(buildScript(endpointFile)), 'utf-8');

    await flushServicesCache();

    return {
      ok: true,
      message:
        'Added "Rephrase with AIBuddy" to the right-click → Services menu. ' +
        'Select text in any app and choose it to rephrase in place.\n\n' +
        "If it doesn't appear yet, enable it under System Settings → Keyboard → " +
        'Keyboard Shortcuts → Services → Text, and re-open the target app.',
    };
  } catch (err) {
    return { ok: false, message: `Couldn't install the right-click menu: ${String(err)}` };
  }
}
