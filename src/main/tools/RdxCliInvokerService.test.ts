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
