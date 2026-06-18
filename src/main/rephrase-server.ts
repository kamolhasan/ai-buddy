import * as http from 'http';
import * as crypto from 'crypto';

export interface RephraseServer {
  port: number;
  token: string;
  close: () => void;
}

interface ServerDeps {
  /**
   * Runs the whole in-place rephrase in the main process: show the popover,
   * generate, and paste the result over the selection via ⌘V. Owns its errors
   * and NEVER pastes empty, so the user's text can't be wiped.
   */
  rephraseAndPaste: (text: string) => Promise<void>;
  log: (message: string) => void;
}

const MAX_BODY_BYTES = 1_000_000; // 1 MB — far beyond any realistic selection.

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * A loopback-only HTTP endpoint backing the macOS right-click rephrase Quick
 * Action. The Quick Action POSTs the selection to /rephrase-inplace; AIBuddy
 * then shows the popover, rephrases, and pastes the result over the selection
 * with ⌘V. We do the paste ourselves (rather than letting macOS "replace
 * selected text") because that path corrupts/wipes the field in Slack when the
 * selection contains a @mention pill.
 *
 * Security: bound to 127.0.0.1 and guarded by a per-launch token.
 */
export function startRephraseServer(deps: ServerDeps): Promise<RephraseServer> {
  const token = crypto.randomBytes(24).toString('hex');

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url?.split('?')[0] !== '/rephrase-inplace') {
      res.writeHead(404).end();
      return;
    }

    if (req.headers['x-aibuddy-token'] !== token) {
      res.writeHead(403).end();
      return;
    }

    try {
      const text = await readBody(req);
      // Length-only logging (never content — it may contain PII).
      deps.log(`/rephrase-inplace: received ${text.length} chars`);
      await deps.rephraseAndPaste(text);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok');
    } catch (err) {
      deps.log(`Rephrase service request failed: ${String(err)}`);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok');
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // Port 0 → OS assigns an ephemeral free port. Loopback only.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        deps.log(`Rephrase service listening on 127.0.0.1:${address.port}`);
        resolve({ port: address.port, token, close: () => server.close() });
      } else {
        reject(new Error('Failed to determine rephrase service port'));
      }
    });
  });
}
