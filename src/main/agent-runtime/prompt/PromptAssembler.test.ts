import { describe, expect, it } from 'vitest';
import type { AgentPermissionSettings } from '@shared/types/settings';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import { PromptAssembler } from './PromptAssembler';

const NATIVE_ROUTE: AgentRouteCapability = {
  providerId: 'openai',
  modelId: 'test-model',
  toolCallingMode: 'native-structured',
  reasoningVisibility: 'hidden',
  reasoningDelivery: 'hidden',
  supportsStreaming: true,
  supportsToolResults: true,
};

function buildPermissions(
  patch: Partial<AgentPermissionSettings> = {},
): AgentPermissionSettings {
  return {
    mode: 'default',
    readableRoots: [],
    writableRoots: [],
    allowedCommandPrefixes: [],
    deniedCommandPrefixes: [],
    ...patch,
  };
}

const assembler = new PromptAssembler();

function buildSystemPrompt(
  permissionSettings: AgentPermissionSettings,
  workspaceRoot = 'D:\\Projects\\Demo',
): string {
  return assembler.assembleSystemPrompt({
    workDir: workspaceRoot,
    tools: ['read_file', 'glob', 'grep'],
    model: { provider: 'openai', name: 'test-model' },
    mode: 'ask',
    profile: {
      agentId: 'ask',
      agentLabel: 'Ask',
      agentDescription: 'Read-only assistant.',
    },
    routeCapability: NATIVE_ROUTE,
    permissionSettings,
    allowedToolNames: ['read_file', 'glob', 'grep'],
  });
}

describe('PromptAssembler permission alignment', () => {
  it('full-access allows machine-wide reads and external absolute paths', () => {
    const prompt = buildSystemPrompt(buildPermissions({ mode: 'full-access' }));

    expect(prompt).toContain('Current permission mode: full-access.');
    expect(prompt).toContain('Readable roots: entire local machine.');
    expect(prompt).toContain('Use read_file with absolute paths for files outside the current project root.');
    expect(prompt).toContain('Do not claim inability to read or write a local path without attempting the tool first.');
  });

  it('default mode instructs attempting read_file for external paths with approval', () => {
    const prompt = buildSystemPrompt(buildPermissions({ mode: 'default' }));

    expect(prompt).toContain('external paths require one-time user approval');
    expect(prompt).toContain('call read_file with its absolute path');
    expect(prompt).toContain('Do not refuse or guess file contents without attempting the tool first.');
  });

  it('auto-review mode warns that external reads are usually denied', () => {
    const prompt = buildSystemPrompt(buildPermissions({ mode: 'auto-review' }));

    expect(prompt).toContain('auto-reviewed and usually denied at medium risk');
    expect(prompt).toContain('switch to Default or Full access');
  });

  it('custom mode lists configured readable and writable roots', () => {
    const prompt = buildSystemPrompt(buildPermissions({
      mode: 'custom',
      readableRoots: ['D:\\Shared', '~/Documents'],
      writableRoots: ['D:\\Scratch'],
    }));

    expect(prompt).toContain('D:\\Shared, ~/Documents');
    expect(prompt).toContain('D:\\Scratch');
    expect(prompt).toContain('Configured readableRoots and writableRoots in settings are allowed without extra approval.');
  });

  it('working directory clarifies project root is default but not exclusive under full-access', () => {
    const prompt = buildSystemPrompt(buildPermissions({ mode: 'full-access' }));

    expect(prompt).toContain('Use it as the default base for relative file paths');
    expect(prompt).toContain('You may also access files outside this project root using absolute paths');
  });
});
