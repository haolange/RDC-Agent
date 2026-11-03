import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

async function runCheck(relativePath: string) {
  await import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

describe('behavior gates', () => {
  it('work-process presentation', async () => {
    await runCheck('scripts/check-work-process-presentation.mjs');
  });

  it('conversation-branch', async () => {
    await runCheck('scripts/check-conversation-branch.mjs');
  });

  it('reasoning delivery', async () => {
    await runCheck('scripts/check-reasoning-delivery.mjs');
  });

  it('i18n catalogs', async () => {
    await runCheck('scripts/check-i18n.mjs');
  });

  it('browser capability', async () => {
    await runCheck('scripts/check-browser-capability.mjs');
  });

  it('settings agents runtime', async () => {
    await runCheck('scripts/check-settings-agents.mjs');
  });

  it('appearance theme', async () => {
    await runCheck('scripts/check-appearance.mjs');
  });
});
