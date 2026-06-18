import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { spawn, execSync } from 'child_process';
import { AIProvider } from './types';

/**
 * Resolve the user's login-shell PATH so that GUI-launched Electron can find
 * binaries installed via nvm, homebrew, etc. Cached after first call.
 */
let _shellPath: string | undefined;
function getShellEnv(): NodeJS.ProcessEnv {
  if (_shellPath === undefined) {
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      _shellPath = execSync(`${shell} -ilc 'echo $PATH'`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch {
      _shellPath = '';
    }
  }
  const env = { ...process.env };
  if (_shellPath) {
    env.PATH = _shellPath;
  }
  return env;
}

export interface AIServiceConfig {
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
}

export type TokenHandler = (delta: string) => void;

export async function generateText(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig
): Promise<string> {
  switch (config.provider) {
    case 'anthropic':
      return generateWithAnthropic(systemPrompt, userContent, config);
    case 'claude-code':
      return generateWithClaudeCode(systemPrompt, userContent, config);
    case 'cursor':
      return generateWithCursor(systemPrompt, userContent, config);
    case 'openai':
    default:
      return generateWithOpenAI(systemPrompt, userContent, config);
  }
}

/**
 * Streaming variant: invokes `onToken` for each text delta and resolves with the
 * full text. Powers the live "typing" result in the command palette.
 */
export async function generateTextStream(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig,
  onToken: TokenHandler
): Promise<string> {
  switch (config.provider) {
    case 'anthropic':
      return streamWithAnthropic(systemPrompt, userContent, config, onToken);
    case 'claude-code':
      return streamWithClaudeCode(systemPrompt, userContent, config, onToken);
    case 'cursor':
      return streamWithCursor(systemPrompt, userContent, config, onToken);
    case 'openai':
    default:
      return streamWithOpenAI(systemPrompt, userContent, config, onToken);
  }
}

async function streamWithOpenAI(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig,
  onToken: TokenHandler
): Promise<string> {
  if (!config.openaiApiKey) {
    throw new Error('OpenAI API key not configured. Add your key in Settings.');
  }

  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: 'https://api.openai.com/v1',
  });

  const stream = await client.chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.7,
    max_tokens: 2048,
    stream: true,
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      full += delta;
      onToken(delta);
    }
  }

  if (!full.trim()) {
    throw new Error('No response from OpenAI');
  }
  return full.trim();
}

async function streamWithAnthropic(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig,
  onToken: TokenHandler
): Promise<string> {
  if (!config.anthropicApiKey) {
    throw new Error('Anthropic API key not configured. Add your key in Settings.');
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const stream = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    stream: true,
  });

  let full = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      full += event.delta.text;
      onToken(event.delta.text);
    }
  }

  if (!full.trim()) {
    throw new Error('No response from Anthropic');
  }
  return full.trim();
}

async function generateWithOpenAI(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig
): Promise<string> {
  if (!config.openaiApiKey) {
    throw new Error('OpenAI API key not configured. Add your key in Settings.');
  }

  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: 'https://api.openai.com/v1',
  });

  const response = await client.chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }
  return content.trim();
}

async function generateWithAnthropic(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig
): Promise<string> {
  if (!config.anthropicApiKey) {
    throw new Error('Anthropic API key not configured. Add your key in Settings.');
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }
  return block.text.trim();
}

// ---------------------------------------------------------------------------
// Claude Code CLI
// ---------------------------------------------------------------------------

function runClaudeCode(
  claudePath: string,
  systemPrompt: string,
  userContent: string,
  model: string,
  onToken?: TokenHandler
): Promise<string> {
  return new Promise((resolve, reject) => {
    // --print (-p) with --output-format=stream-json requires --verbose.
    // Pass the rewriting rules as the SYSTEM prompt (authoritative, and it
    // overrides Claude Code's default agentic prompt) and send only the user's
    // text as the turn — so the model rewrites it instead of narrating about it.
    const args = ['-p', '--max-turns', '1', '--output-format', 'stream-json', '--verbose'];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }
    if (model) {
      args.push('--model', model);
    }
    const proc = spawn(claudePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getShellEnv(),
    });

    let streamed = '';      // text from content_block_delta events (partial mode)
    let assistantText = '';  // text blocks from assistant messages
    let resultText = '';     // final text from the result event
    let stderrBuf = '';
    let lineBuf = '';        // buffers a partial JSON line across stdout chunks
    // Errors in --output-format stream-json arrive as JSON events on STDOUT (not
    // stderr), so we capture them here to produce a useful message.
    let errorMessage = '';

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        // With --output-format stream-json every complete line is JSON. A line
        // that doesn't parse is a truncated fragment (e.g. process killed
        // mid-line); ignore it rather than leaking raw JSON into the result.
        return;
      }

      if (event.type === 'content_block_delta') {
        const text = event.delta?.text;
        if (text) {
          streamed += text;
          onToken?.(text);
        }
      } else if (event.type === 'assistant') {
        // The assistant message carries the full text in its content blocks.
        for (const block of event.message?.content ?? []) {
          if (block?.type === 'text' && block.text) assistantText += block.text;
        }
      } else if (event.type === 'result') {
        if (event.is_error) {
          errorMessage = event.result || event.error || event.subtype || 'unknown error';
        } else if (typeof event.result === 'string') {
          resultText = event.result;
        }
      }
      // A bare error field can appear on init/system events (e.g. a bad model).
      if (!errorMessage && typeof event.error === 'string') {
        errorMessage = event.error;
      }
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      lineBuf += chunk.toString();
      let idx: number;
      // Process only complete lines; keep any trailing partial line buffered so
      // JSON events split across chunks are reassembled, not mis-parsed.
      while ((idx = lineBuf.indexOf('\n')) >= 0) {
        handleLine(lineBuf.slice(0, idx));
        lineBuf = lineBuf.slice(idx + 1);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on('error', (err: Error) => {
      reject(
        new Error(
          `Failed to start Claude Code CLI ('${claudePath}'): ${err.message}. ` +
            'Is it installed and in your PATH?'
        )
      );
    });

    proc.on('close', (code: number | null) => {
      if (lineBuf.trim()) handleLine(lineBuf); // flush any final unterminated line
      // Prefer the streamed deltas, then the final result, then assistant text.
      const full = (streamed.trim() ? streamed : resultText || assistantText) || '';
      const failed = !!errorMessage || (code !== 0 && code !== null);
      if (failed) {
        if (/model_not_found|selected model|model.*(not found|not exist|access)/i.test(errorMessage)) {
          reject(
            new Error(
              `Claude Code couldn't find the model${model ? ` "${model}"` : ''}. ` +
                'Set a valid model in Settings (e.g. "haiku", "sonnet", or "opus"), ' +
                'or leave it blank to use the CLI default.'
            )
          );
        } else {
          const detail = errorMessage || stderrBuf.trim() || 'no output';
          reject(new Error(`Claude Code error: ${detail}`));
        }
      } else if (!full.trim()) {
        reject(new Error('No response from Claude Code'));
      } else {
        // If we never streamed (no partial-message deltas), emit once for the UI.
        if (!streamed.trim() && full) onToken?.(full);
        resolve(full.trim());
      }
    });

    proc.stdin.write(userContent);
    proc.stdin.end();
  });
}

async function streamWithClaudeCode(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig,
  onToken: TokenHandler
): Promise<string> {
  const claudePath = config.claudeCodePath || 'claude';
  return runClaudeCode(claudePath, systemPrompt, userContent, config.claudeCodeModel, onToken);
}

async function generateWithClaudeCode(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig
): Promise<string> {
  const claudePath = config.claudeCodePath || 'claude';
  return runClaudeCode(claudePath, systemPrompt, userContent, config.claudeCodeModel);
}

// ---------------------------------------------------------------------------
// Cursor (OpenAI-compatible endpoint)
// ---------------------------------------------------------------------------

async function streamWithCursor(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig,
  onToken: TokenHandler
): Promise<string> {
  if (!config.cursorEndpoint) {
    throw new Error('Cursor endpoint not configured. Add the URL in Settings.');
  }

  const client = new OpenAI({
    apiKey: config.cursorApiKey || 'not-needed',
    baseURL: config.cursorEndpoint,
  });

  const stream = await client.chat.completions.create({
    model: config.cursorModel || 'cursor-small',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.7,
    max_tokens: 2048,
    stream: true,
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      full += delta;
      onToken(delta);
    }
  }

  if (!full.trim()) {
    throw new Error('No response from Cursor endpoint');
  }
  return full.trim();
}

async function generateWithCursor(
  systemPrompt: string,
  userContent: string,
  config: AIServiceConfig
): Promise<string> {
  if (!config.cursorEndpoint) {
    throw new Error('Cursor endpoint not configured. Add the URL in Settings.');
  }

  const client = new OpenAI({
    apiKey: config.cursorApiKey || 'not-needed',
    baseURL: config.cursorEndpoint,
  });

  const response = await client.chat.completions.create({
    model: config.cursorModel || 'cursor-small',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from Cursor endpoint');
  }
  return content.trim();
}
