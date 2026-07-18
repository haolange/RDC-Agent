import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fail = (message) => {
  console.error(`[provider-system] ${message}`);
  process.exit(1);
};

const removedPaths = [
  'src/main/settings/presets',
  'src/main/settings/ProviderPresetRegistry.ts',
  'src/main/settings/CanonicalProviderPresetFactory.ts',
  'src/main/settings/CanonicalProviderFacts.ts',
  'src/main/settings/CanonicalProviderWireFacts.ts',
  'src/main/settings/ModelsDevProviderRegistry.ts',
];
for (const relativePath of removedPaths) {
  const absolutePath = path.join(repoRoot, relativePath);
  const existsWithContent = fs.existsSync(absolutePath)
    && (!fs.statSync(absolutePath).isDirectory() || fs.readdirSync(absolutePath).length > 0);
  if (existsWithContent) {
    fail(`removed Catalog path returned: ${relativePath}`);
  }
}

const forbiddenSymbols = [
  'ProviderPresetRegistry',
  'createCanonicalProviderPresets',
  'ExecutionVariantRule',
  'FastCapability',
  'OneMillionContextCapability',
  'SeedModelDefinition',
  'CapabilityConstraint',
  'model-variant',
];
const scanRoots = ['src', 'scripts'];
const extensions = new Set(['.ts', '.tsx', '.mjs', '.cjs']);
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(absolute);
      continue;
    }
    if (!extensions.has(path.extname(entry.name))) continue;
    const relative = path.relative(repoRoot, absolute).replaceAll('\\', '/');
    if (relative === 'scripts/check-provider-system.mjs') continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const symbol of forbiddenSymbols) {
      if (source.includes(symbol)) fail(`${relative} reintroduced forbidden Catalog symbol ${symbol}`);
    }
  }
};
for (const root of scanRoots) visit(path.join(repoRoot, root));

const manifestRoot = path.join(repoRoot, 'src/shared/provider-catalog/manifests');
for (const directory of ['identities', 'profiles', 'surfaces']) {
  const files = fs.readdirSync(path.join(manifestRoot, directory));
  if (files.some((file) => path.extname(file) !== '.json')) {
    fail(`${directory} contains a non-JSON manifest`);
  }
}

const registrySource = fs.readFileSync(path.join(repoRoot, 'src/main/provider-catalog/ProviderCatalogRegistry.ts'), 'utf8');
if (!registrySource.includes("from 'virtual:rdc-provider-catalog-index'")) {
  fail('ProviderCatalogRegistry must consume the compiled virtual index and lazy surface chunks');
}
for (const forbidden of ['nodeManifestLoader', 'compileProviderCatalog(', 'src/shared/provider-catalog/manifests']) {
  if (registrySource.includes(forbidden)) fail(`ProviderCatalogRegistry contains a source-manifest runtime fallback: ${forbidden}`);
}

const liveParserSource = fs.readFileSync(
  path.join(repoRoot, 'src/main/settings/LiveProviderCatalogParsers.ts'),
  'utf8',
);
for (const forbidden of [
  'kimi-for-coding',
  'kimi-for-coding-highspeed',
  'kimi-k2.7-code',
  'moonshotai/kimi-k3',
  'grok-composer-2.5-fast',
  'Kimi K3',
  'Composer 2.5',
]) {
  if (liveParserSource.includes(forbidden)) {
    fail(`LiveProviderCatalogParsers reintroduced manifest-owned product fact ${forbidden}`);
  }
}

const settingsSource = fs.readFileSync(path.join(repoRoot, 'src/main/settings/SettingsService.ts'), 'utf8');
if (settingsSource.includes('discoveryPolicyId ===')) {
  fail('SettingsService must derive persistence from the authority matrix, not parser policy ids');
}
const connectionSource = fs.readFileSync(path.join(repoRoot, 'src/main/settings/ProviderConnectionService.ts'), 'utf8');
if (connectionSource.includes("provider.id === 'moonshot'")) {
  fail('Moonshot discovery must use its declarative manifest instead of a Provider id branch');
}

const contractTests = [
  'src/shared/provider-catalog/compiler.test.ts',
  'src/shared/utils/modelControls.test.ts',
  'src/main/settings/RequestPlanner.test.ts',
  'src/main/settings/EffectiveModelResolver.test.ts',
  'src/main/settings/ProviderConnectionService.test.ts',
  'src/main/settings/ProviderRouteUrl.test.ts',
  'src/main/settings/ProviderCapabilityContract.test.ts',
  'src/main/settings/LiveProviderCatalogParsers.test.ts',
  'src/main/settings/CopilotBilling.test.ts',
];
const vitest = path.join(repoRoot, 'node_modules/vitest/vitest.mjs');
const result = spawnSync(process.execPath, [vitest, 'run', ...contractTests], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});
if (result.error) fail(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);

console.log('[provider-system] compiled Catalog, control resolution, discovery, route, and wire contracts passed.');
