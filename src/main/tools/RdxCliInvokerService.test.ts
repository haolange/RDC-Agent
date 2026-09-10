import { describe, expect, it, vi } from 'vitest';

vi.mock('../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({
      tooling: {
        rdxCli: {
          enabled: false,
          command: '',
          argsPrefix: [],
          workingDirectory: '',
          env: {},
          timeoutMs: 30_000,
          catalogPath: '',
          jsonMode: 'auto',
        },
      },
    }),
  },
}));

import { RdxCliInvokerService } from './RdxCliInvokerService';

describe('RdxCliInvokerService.getRuntimeSummary', () => {
  it('returns diagnostic fields without recommendedSpecialists', async () => {
    const summary = await new RdxCliInvokerService().getRuntimeSummary();
    expect(summary).toMatchObject({
      runtime: expect.objectContaining({
        source: 'unconfigured',
        command: '',
      }),
      cli: expect.objectContaining({
        available: false,
      }),
      namespaces: expect.any(Array),
    });
    expect(summary).not.toHaveProperty('recommendedSpecialists');
    expect(JSON.stringify(summary)).not.toContain('recommendedSpecialists');
  });
});

it('tags context-scoped action invocation ownership separately from native argv', async () => {
  const service = new RdxCliInvokerService();
  const invoke = vi.spyOn(service, 'executeCLI').mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'orphan', duration_ms: 1, processExitReason: 'unconfirmed_orphan' });
  await service.call({ toolName: 'rd.shader.replace', args: {}, contextId: 'owned-context', runId: 'run' });
  expect(invoke).toHaveBeenCalledWith('call', expect.arrayContaining(['--daemon-context', 'owned-context']), expect.objectContaining({ contextId: 'owned-context', runId: 'run' }));
});
