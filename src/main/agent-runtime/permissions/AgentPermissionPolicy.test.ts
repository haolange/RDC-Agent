import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { AgentTool } from '../agent/AgentTool';
import type { ToolCall } from '../core/types';
import { AgentPermissionPolicyService } from './AgentPermissionPolicy';

const { mockSettings } = vi.hoisted(() => ({
  mockSettings: {
    workspace: { rootPath: 'D:\\AppWorkspace' },
    agentRuntime: {
      permissions: {
        mode: 'full-access' as AgentPermissionMode,
        readableRoots: [] as string[],
        writableRoots: [] as string[],
        allowedCommandPrefixes: [] as string[],
        deniedCommandPrefixes: [] as string[],
      },
    },
  },
}));

vi.mock('../../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => mockSettings,
  },
}));

const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'read file',
  parameters: { type: 'object', properties: {} },
  permissionHint: 'readonly',
  execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
};

function makeToolCall(path: string): ToolCall {
  return {
    type: 'toolCall',
    id: 'tc-1',
    name: 'read_file',
    arguments: { path },
  };
}

describe('AgentPermissionPolicyService external reads', () => {
  const service = new AgentPermissionPolicyService();

  beforeEach(() => {
    mockSettings.agentRuntime.permissions.mode = 'full-access';
  });

  it('allows full-access reads outside the project root without asking', () => {
    const decision = service.evaluate({
      agentId: 'ask',
      tool: readFileTool,
      toolCall: makeToolCall('D:\\OtherProject\\src\\main.ts'),
      projectRootPath: 'D:\\Projects\\Demo',
    });

    expect(decision.action).toBe('allow');
    expect(decision.temporaryPathRoots).toEqual(['*']);
  });

  it('requests approval for default-mode external reads', () => {
    mockSettings.agentRuntime.permissions.mode = 'default';

    const decision = service.evaluate({
      agentId: 'ask',
      tool: readFileTool,
      toolCall: makeToolCall('D:\\OtherProject\\src\\main.ts'),
      projectRootPath: 'D:\\Projects\\Demo',
    });

    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toContain('Read access is outside the workspace');
  });

  it('auto-reviews external reads in auto-review mode', () => {
    mockSettings.agentRuntime.permissions.mode = 'auto-review';

    const decision = service.evaluate({
      agentId: 'ask',
      tool: readFileTool,
      toolCall: makeToolCall('D:\\OtherProject\\src\\main.ts'),
      projectRootPath: 'D:\\Projects\\Demo',
    });

    expect(decision.action).toBe('auto_review');
    expect(decision.risk).toBe('medium');
  });

  it('allows custom-mode reads inside configured readableRoots', () => {
    mockSettings.agentRuntime.permissions.mode = 'custom';
    mockSettings.agentRuntime.permissions.readableRoots = ['D:\\Shared'];

    const decision = service.evaluate({
      agentId: 'ask',
      tool: readFileTool,
      toolCall: makeToolCall('D:\\Shared\\notes.txt'),
      projectRootPath: 'D:\\Projects\\Demo',
    });

    expect(decision.action).toBe('allow');
    expect(decision.temporaryPathRoots.some((root) => root.includes('Shared'))).toBe(true);
  });
});
