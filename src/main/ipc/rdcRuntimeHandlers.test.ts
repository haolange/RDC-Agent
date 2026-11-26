import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const mocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  confirm: vi.fn(),
  overview: vi.fn((projectRoot?: string) => ({ projectRoot })),
  importFromFile: vi.fn(() => ({ id: 'imported' })),
  trustProjectMcp: vi.fn(() => ({ trusted: true })),
  listMcpServers: vi.fn(),
}));
const projectRoot = path.resolve('/fixture/project');

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  shell: { showItemInFolder: vi.fn() },
}));
vi.mock('../window/mainConfirmation', () => ({ confirmInMainProcess: mocks.confirm }));
vi.mock('../window/nativeI18n', () => ({
  nativeMessage: (key: string, params?: { value?: string }) => `${key}=${params?.value ?? ''}`,
}));
vi.mock('../hooks/HookEngine', () => ({ hookEngine: { load: vi.fn(() => []), list: vi.fn(() => []) } }));
vi.mock('../agent-runtime/prompt', () => ({ requestSnapshotStore: {} }));
vi.mock('../sessions/store/sessionStores', () => ({
  projectWorkspaceStore: { listProjects: () => [{ rootPath: projectRoot }] },
}));
vi.mock('../settings/agent-manifests/AgentRuntimeConfigService', () => ({
  agentRuntimeConfigService: { listMcpServers: mocks.listMcpServers },
}));
vi.mock('../settings/agent-manifests/ScopedRuntimeService', () => ({
  SCOPED_IMPORT_EXTENSIONS: { hook: ['yml', 'yaml'] },
  scopedRuntimeService: {
    overview: mocks.overview,
    importFromFile: mocks.importFromFile,
    trustProjectMcp: mocks.trustProjectMcp,
  },
}));

import { registerRdcRuntimeHandlers } from './rdcRuntimeHandlers';

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockClear());
  handlers.clear();
  registerRdcRuntimeHandlers();
});

describe('rdc runtime handlers', () => {
  it('refuses a project root that is not a registered project before touching the disk', () => {
    expect(() => invoke('rdc-runtime:overview', path.resolve('/elsewhere'))).toThrow(/^PROJECT_ROOT_UNKNOWN: /u);
    expect(mocks.overview).not.toHaveBeenCalled();
    invoke('rdc-runtime:overview', projectRoot);
    expect(mocks.overview).toHaveBeenCalledWith(projectRoot);
  });

  it('shows exactly what a project MCP server runs, with environment variable names but not their values', async () => {
    mocks.listMcpServers.mockReturnValue([
      {
        id: 'probe',
        name: 'Probe',
        scope: 'project',
        transport: 'stdio',
        sourcePath: '/fixture/project/.rdc-agent/mcp/probe.json',
        command: 'node',
        args: ['server.js', '--root', 'a b'],
        env: { API_TOKEN: 'value-never-shown' },
      },
    ]);
    mocks.confirm.mockResolvedValue(false);
    await invoke('rdc-runtime:trustMcp', projectRoot, 'probe');
    const { detail } = mocks.confirm.mock.calls[0][0] as { detail: string };
    expect(detail).toContain('mcpCommand=node server.js --root "a b"');
    expect(detail).toContain('mcpEnvKeys=API_TOKEN');
    expect(detail).not.toContain('value-never-shown');
    expect(mocks.trustProjectMcp).not.toHaveBeenCalled();
  });

  it("imports only a file the person picked in main's dialog", async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(invoke('rdc-runtime:import', { kind: 'hook', scope: 'project', projectRoot })).resolves.toBeNull();
    expect(mocks.importFromFile).not.toHaveBeenCalled();

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/picked/check.hook.yml'] });
    await expect(invoke('rdc-runtime:import', { kind: 'hook', scope: 'project', projectRoot })).resolves.toMatchObject({
      id: 'imported',
    });
    expect(mocks.importFromFile).toHaveBeenCalledWith({
      kind: 'hook',
      scope: 'project',
      projectRoot,
      filePath: '/picked/check.hook.yml',
    });
  });
});
