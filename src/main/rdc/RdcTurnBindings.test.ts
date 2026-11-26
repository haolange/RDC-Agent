import { expect, it } from 'vitest';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
it('retains complete CLI, nested definition and lease identity across later mutations', () => {
  const cli = {
    enabled: true,
    command: 'A',
    argsPrefix: ['entry'],
    workingDirectory: 'cwd',
    env: { X: 'A' },
    noProgressTimeoutMs: 30_000,
  };
  const definitions = [
    {
      name: 'rd.event.get_action_tree',
      input_schema: { properties: { filter: { properties: { name_contains: { type: 'string' } } } } },
    },
  ];
  const identity = { contextId: 'owned', version: 3, ownerSessionId: 'owner' };
  const bound = freezeRdcTurnBinding(cli, definitions, identity);
  cli.command = 'B';
  cli.env.X = 'B';
  definitions[0].input_schema.properties.filter.properties.name_contains.type = 'number';
  identity.contextId = 'foreign';
  expect(bound.cli.command).toBe('A');
  expect(bound.cli.env.X).toBe('A');
  expect(bound.identity?.contextId).toBe('owned');
  expect(bound.definitions).not.toEqual(definitions);
  expect(Object.isFrozen(bound.definitions[0].input_schema)).toBe(true);
  expect(Object.isFrozen(bound.identity)).toBe(true);
});

it('refuses to freeze a patience the frozen catalog would reject before execution', () => {
  const cli = {
    enabled: true,
    command: 'A',
    argsPrefix: [],
    workingDirectory: '',
    env: {},
    noProgressTimeoutMs: 45_000,
  };
  const budget = { rule: 'no_progress', default_no_progress_ms: 300_000, max_no_progress_ms: 3_600_000 };
  const definition = (min: number) => ({
    name: 'rd.event.get_action_tree',
    execution_budget: { ...budget, min_no_progress_ms: min },
  });
  expect(freezeRdcTurnBinding(cli, [definition(30_000)]).cli.noProgressTimeoutMs).toBe(45_000);
  expect(() => freezeRdcTurnBinding(cli, [definition(30_000), definition(60_000)])).toThrow(
    expect.objectContaining({
      code: 'RDC_NO_PROGRESS_TIMEOUT_UNSUPPORTED',
      params: { seconds: 45, minSeconds: 60, maxSeconds: 3600 },
    }),
  );
});
