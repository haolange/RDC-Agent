import { describe, expect, it } from 'vitest';
import { AGENT_WORKBENCH_COMMAND_CATALOG } from '@shared/constants/agentWorkbenchCatalog';
import { assertWorkbenchCommandCopy, workbenchCommandDescriptionKey } from './commandLabels';

describe('workbench command copy', () => {
  it('maps every shared command to a renderer translation key', () => {
    expect(() => assertWorkbenchCommandCopy()).not.toThrow();
    expect(AGENT_WORKBENCH_COMMAND_CATALOG.map((entry) => workbenchCommandDescriptionKey(entry.command)))
      .toContain('composer.commandDescription.context');
  });
});
