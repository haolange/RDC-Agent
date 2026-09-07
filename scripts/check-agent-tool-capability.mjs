import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fail = (message) => {
  console.error(`[agent-tool-capability] ${message}`);
  process.exit(1);
};

const picker = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/composer/composerModelPicker.ts'), 'utf8');
if (!picker.includes('isAgentToolExecutableModel')) {
  fail('Composer picker must use isAgentToolExecutableModel');
}
if (picker.includes('isEffectiveModelPickerSelectable')) {
  fail('Composer picker must not use the catalog-visibility gate for Agent models');
}

const preflight = fs.readFileSync(path.join(repoRoot, 'src/main/conversation/ConversationRoutePreflight.ts'), 'utf8');
if (!preflight.includes('CONVERSATION_LLM_TOOLS_UNAVAILABLE') || !preflight.includes('isAgentToolExecutableModel')) {
  fail('Route preflight must fail closed through the shared Agent tool-eligibility gate');
}

const sessionHandler = fs.readFileSync(path.join(repoRoot, 'src/main/ipc/projectSessionHandlers.ts'), 'utf8');
if (!sessionHandler.includes('isAgentToolExecutableModel')) {
  fail('session:setModelOverride must use the shared Agent tool-eligibility gate');
}

const resolveOverride = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/features/composer/resolveComposerModelOverride.ts'),
  'utf8',
);
if (resolveOverride.includes('AgentModelOption') || resolveOverride.includes('isComposerOverrideOption')) {
  fail('/model resolver must use Composer picker options, not AgentModelOption');
}
if (!resolveOverride.includes('ComposerModelPickerOption')) {
  fail('/model resolver must accept ComposerModelPickerOption');
}

const slash = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/features/composer/slashCommandExecutor.ts'),
  'utf8',
);
if (slash.includes('modelOptions')) {
  fail('/model must not read settings.agents.modelOptions');
}
if (
  !slash.includes('loadComposerModelPickerOptions')
  || !slash.includes('isComposerAgentDefaultToken')
  || !slash.includes('clearComposerModelChoice')
) {
  fail('/model must share the picker catalog and Follow Agent clear path');
}

const loader = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/features/composer/useComposerModelPickerOptions.ts'),
  'utf8',
);
if (
  !loader.includes('export async function loadComposerModelPickerOptions')
  || !loader.includes('isComposerPickerModel')
) {
  fail('Composer picker loader must stay the shared EffectiveCatalog path');
}

const vitest = path.join(repoRoot, 'node_modules/vitest/vitest.mjs');
const result = spawnSync(process.execPath, [vitest, 'run',
  'src/shared/utils/agentToolCapability.test.ts',
  'src/shared/provider-catalog/agentToolCapabilityAudit.test.ts',
  'src/main/agent-runtime/capabilities/RouteCapabilityResolver.test.ts',
  'src/main/conversation/ConversationRoutePreflight.test.ts',
  'src/main/settings/RequestPlanner.test.ts',
  'src/main/settings/EffectiveCatalogService.test.ts',
  'src/renderer/features/composer/composerModelPicker.test.ts',
  'src/renderer/features/composer/resolveComposerModelOverride.test.ts',
  'src/main/testing/contracts/providerWireFixture.test.ts',
], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});
if (result.error) fail(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('[agent-tool-capability] shared gate, catalog audit, picker, and preflight contracts passed.');
