import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AgentTool } from '../../agent/AgentTool';
import { requireMutationWorkspaceRoot, truncateOutput } from './_shared';
import { BASH_MAX_OUTPUT_BYTES } from './toolLimits';
import { processSupervisor } from '../../../runtime/ProcessSupervisor';
import { settingsService } from '../../../settings/SettingsService';
import { recordToolImagePreview } from '../../../conversation/ToolImagePreviewStore';
import { detectImageMagicMime } from '../../../conversation/ConversationAttachmentMaterializer';

interface InterpreterParams {
  code: string;
  language?: string;
}

interface InterpreterDetails {
  command: string;
  language: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  cwd: string;
  artifactsDir: string;
  imagePreviews?: Array<{
    previewId: string;
    fileName: string;
    mimeType: string;
    width?: number;
    height?: number;
  }>;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function resolveInterpreterCommand(configured: string): string {
  const trimmed = configured.trim();
  if (trimmed) return trimmed;
  return process.platform === 'win32' ? 'python' : 'python3';
}

export const codeInterpreterTool: AgentTool<InterpreterParams, InterpreterDetails> = {
  name: 'code_interpreter',
  label: '代码解释器',
  description:
    'Run a short script with the locally configured interpreter (default: system Python). Artifacts written to RDC_INTERPRETER_ARTIFACTS_DIR are collected. Requires Settings → Tools interpreter configuration to be enabled.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Source to execute.' },
      language: { type: 'string', description: 'Interpreter language hint. Only python is supported.' },
    },
    required: ['code'],
  },
  spec: {
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: false,
    sideEffect: 'process',
    category: 'system',
    requiresApproval: true,
  },
  permissionHint: 'mutation',

  async execute(toolCallId, params, signal, onUpdate, context) {
    const settings = settingsService.getAll().tooling.codeInterpreter;
    if (!settings.enabled) {
      throw new Error('CODE_INTERPRETER_DISABLED: enable the interpreter in Settings → Tools.');
    }
    const language = (params.language ?? 'python').trim().toLowerCase();
    if (language && language !== 'python' && language !== 'py') {
      throw new Error(`CODE_INTERPRETER_UNSUPPORTED_LANGUAGE: ${language}`);
    }
    const cwd = requireMutationWorkspaceRoot(context);
    const command = resolveInterpreterCommand(settings.command);
    const artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-interp-'));
    const startedAt = Date.now();
    const args = [...settings.argsPrefix, '-c', params.code];
    const env = {
      ...process.env,
      ...settings.env,
      RDC_INTERPRETER_ARTIFACTS_DIR: artifactsDir,
      PYTHONIOENCODING: 'utf-8',
    };

    let stdout = '';
    const supervised = processSupervisor.spawn('shell', command, args, {
      cwd,
      env,
      windowsHide: true,
      isolateProcessGroup: process.platform !== 'win32',
      timeoutMs: settings.timeoutMs,
      abortSignal: signal,
      ringBufferBytes: BASH_MAX_OUTPUT_BYTES * 2,
    });
    supervised.child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      onUpdate?.({ content: [{ type: 'text', text: truncateOutput(stdout, BASH_MAX_OUTPUT_BYTES) }] });
    });
    supervised.child.stderr?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      onUpdate?.({ content: [{ type: 'text', text: truncateOutput(stdout, BASH_MAX_OUTPUT_BYTES) }] });
    });
    const info = await supervised.join(settings.timeoutMs);
    stdout = supervised.stdout.toString() || stdout;
    const stderr = supervised.stderr.toString();
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    const imagePreviews = settings.artifactsEnabled && context?.sessionId
      ? await collectArtifactPreviews(artifactsDir, context.sessionId, toolCallId)
      : [];
    const failed = info.reason !== 'exit' || info.code !== 0;
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      { type: 'text', text: truncateOutput(combined || (failed ? '[interpreter failed]' : '[ok]'), BASH_MAX_OUTPUT_BYTES) },
    ];
    if (context?.visionInputMode === 'native') {
      for (const preview of imagePreviews) {
        const bytes = await fs.readFile(path.join(artifactsDir, preview.fileName)).catch(() => null);
        if (!bytes) continue;
        content.push({ type: 'image', data: bytes.toString('base64'), mimeType: preview.mimeType });
      }
    }
    return {
      content,
      isError: failed,
      details: {
        command,
        language: 'python',
        exitCode: info.code,
        durationMs: Date.now() - startedAt,
        truncated: Buffer.byteLength(combined, 'utf8') > BASH_MAX_OUTPUT_BYTES,
        cwd,
        artifactsDir,
        imagePreviews,
      },
    };
  },
};

async function collectArtifactPreviews(
  artifactsDir: string,
  sessionId: string,
  toolCallId: string,
): Promise<NonNullable<InterpreterDetails['imagePreviews']>> {
  const entries = await fs.readdir(artifactsDir, { withFileTypes: true }).catch(() => []);
  const previews: NonNullable<InterpreterDetails['imagePreviews']> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
    const filePath = path.join(artifactsDir, entry.name);
    const header = await fs.readFile(filePath).then((bytes) => bytes.subarray(0, 16)).catch(() => null);
    if (!header) continue;
    const mimeType = detectImageMagicMime(header);
    if (!mimeType || mimeType === 'image/svg+xml') continue;
    const recorded = await recordToolImagePreview({
      sessionId,
      toolCallId,
      fileName: entry.name,
      sourcePath: filePath,
      mimeType,
    });
    previews.push(recorded);
  }
  return previews;
}
