import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { AgentTool } from '../agent/AgentTool';
import type { ToolCall } from '../core/types';
import { AgentPermissionPolicyService } from './AgentPermissionPolicy';

const { mockSettings } = vi.hoisted(() => ({
  mockSettings: {
    paths: { userRdxRoot: 'D:\\AppWorkspace' },
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

const fixtureRoot = path.join(os.tmpdir(), 'rdc-agent-permission-tests');
const workspaceRoot = path.join(fixtureRoot, 'workspace');
const externalRoot = path.join(fixtureRoot, 'external');
const readableRoot = path.join(fixtureRoot, 'shared');

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

const webSearchTool: AgentTool = {
  name: 'web_search',
  description: 'search web',
  parameters: { type: 'object', properties: {} },
  permissionHint: 'readonly',
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'network', category: 'web', requiresApproval: false },
  execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
};

function makeReadFileToolCall(path: string): ToolCall {
  return {
    type: 'toolCall',
    id: 'tc-1',
    name: 'read_file',
    arguments: { path },
  };
}

function makeWebSearchToolCall(query: string): ToolCall {
  return {
    type: 'toolCall',
    id: 'tc-web',
    name: 'web_search',
    arguments: { query },
  };
}

describe('AgentPermissionPolicyService external reads', () => {
  const service = new AgentPermissionPolicyService();

  beforeEach(() => {
    mockSettings.agentRuntime.permissions.mode = 'full-access';
    mockSettings.agentRuntime.permissions.readableRoots = [];
    mockSettings.agentRuntime.permissions.writableRoots = [];
    mockSettings.agentRuntime.permissions.allowedCommandPrefixes = [];
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = [];
  });

  it('allows full-access reads outside the project root without asking', () => {
    const decision = service.evaluate({
      tool: readFileTool,
      toolCall: makeReadFileToolCall(path.join(externalRoot, 'src', 'main.ts')),
      projectRootPath: workspaceRoot,
    });

    expect(decision.action).toBe('allow');
    expect(decision.temporaryPathRoots).toEqual(['*']);
  });

  it('requests approval for default-mode external reads', () => {
    mockSettings.agentRuntime.permissions.mode = 'default';

    const decision = service.evaluate({
      tool: readFileTool,
      toolCall: makeReadFileToolCall(path.join(externalRoot, 'src', 'main.ts')),
      projectRootPath: workspaceRoot,
    });

    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toContain('Read access is outside the workspace');
  });

  it('auto-reviews external reads in auto-review mode', () => {
    mockSettings.agentRuntime.permissions.mode = 'auto-review';

    const decision = service.evaluate({
      tool: readFileTool,
      toolCall: makeReadFileToolCall(path.join(externalRoot, 'src', 'main.ts')),
      projectRootPath: workspaceRoot,
    });

    expect(decision.action).toBe('auto_review');
    expect(decision.risk).toBe('medium');
  });

  it('allows custom-mode reads inside configured readableRoots', () => {
    mockSettings.agentRuntime.permissions.mode = 'custom';
    mockSettings.agentRuntime.permissions.readableRoots = [readableRoot];

    const decision = service.evaluate({
      tool: readFileTool,
      toolCall: makeReadFileToolCall(path.join(readableRoot, 'notes.txt')),
      projectRootPath: workspaceRoot,
    });

    expect(decision.action).toBe('allow');
    expect(decision.temporaryPathRoots).toContain(path.join(readableRoot, 'notes.txt'));
  });
});

describe('AgentPermissionPolicyService network tools', () => {
  const service = new AgentPermissionPolicyService();

  beforeEach(() => {
    mockSettings.agentRuntime.permissions.mode = 'full-access';
    mockSettings.agentRuntime.permissions.readableRoots = [];
    mockSettings.agentRuntime.permissions.writableRoots = [];
    mockSettings.agentRuntime.permissions.allowedCommandPrefixes = [];
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = [];
  });

  it('allows network tools in full-access mode', () => {
    const decision = service.evaluate({
      tool: webSearchTool,
      toolCall: makeWebSearchToolCall('RenderDoc'),
      projectRootPath: 'D:\\Projects\\Demo',
    });

    expect(decision.action).toBe('allow');
  });

  it('requests approval for network tools in default mode', () => {
    mockSettings.agentRuntime.permissions.mode = 'default';

    const decision = service.evaluate({
      tool: webSearchTool,
      toolCall: makeWebSearchToolCall('RenderDoc'),
      projectRootPath: 'D:\\Projects\\Demo',
    });

    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toContain('Network tool "web_search" requires approval');
    expect(decision.risk).toBe('medium');
  });

  it('auto-reviews network tools in auto-review mode', () => {
    mockSettings.agentRuntime.permissions.mode = 'auto-review';

    const decision = service.evaluate({
      tool: webSearchTool,
      toolCall: makeWebSearchToolCall('RenderDoc'),
      projectRootPath: 'D:\\Projects\\Demo',
    });

    expect(decision.action).toBe('auto_review');
    expect(decision.risk).toBe('medium');
  });

  it('allows network tools in custom mode after explicit policy selection', () => {
    mockSettings.agentRuntime.permissions.mode = 'custom';

    const decision = service.evaluate({
      tool: webSearchTool,
      toolCall: makeWebSearchToolCall('RenderDoc'),
      projectRootPath: 'D:\\Projects\\Demo',
    });

    expect(decision.action).toBe('allow');
  });
});
