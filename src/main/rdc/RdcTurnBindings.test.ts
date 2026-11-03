import { expect, it } from 'vitest';
import { freezeRdcTurnBinding } from './RdcTurnBindings';
it('retains complete CLI, nested definition and lease identity across later mutations', () => {
  const cli = { enabled: true, command: 'A', argsPrefix: ['entry'], workingDirectory: 'cwd', env: { X: 'A' }, timeoutMs: 30000 };
  const definitions = [{ name: 'rd.event.get_action_tree', input_schema: { properties: { filter: { properties: { name_contains: { type: 'string' } } } } } }];
  const identity = { contextId: 'owned', version: 3, ownerSessionId: 'owner' };
  const bound = freezeRdcTurnBinding(cli, definitions, identity);
  cli.command = 'B'; cli.env.X = 'B'; definitions[0].input_schema.properties.filter.properties.name_contains.type = 'number'; identity.contextId = 'foreign';
  expect(bound.cli.command).toBe('A'); expect(bound.cli.env.X).toBe('A'); expect(bound.identity?.contextId).toBe('owned');
  expect(bound.definitions).not.toEqual(definitions);
  expect(Object.isFrozen(bound.definitions[0].input_schema)).toBe(true);
  expect(Object.isFrozen(bound.identity)).toBe(true);
});
