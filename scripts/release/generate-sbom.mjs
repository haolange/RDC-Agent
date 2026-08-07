#!/usr/bin/env node
/**
 * Minimal CycloneDX-lite SBOM from package.json dependencies (no new runtime deps).
 * Writes release/sbom.cdx.json (creates release/ when needed).
 * Integrity digest is written beside the BOM as release/sbom.cdx.json.sha256
 * so the BOM bytes themselves are not mutated after hashing.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function componentsFromDeps(deps, scope) {
  return Object.entries(deps ?? {}).map(([name, version]) => {
    const purl = `pkg:npm/${encodeURIComponent(name)}@${String(version).replace(/^[^0-9a-zA-Z.~+-]+/, '')}`;
    return {
      type: 'library',
      name,
      version: String(version),
      scope,
      purl,
      'bom-ref': purl,
    };
  });
}

const components = [
  ...componentsFromDeps(packageJson.dependencies, 'required'),
  ...componentsFromDeps(packageJson.devDependencies, 'optional'),
].sort((a, b) => a.name.localeCompare(b.name));

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: packageJson.name ?? 'rdc-agent',
      version: packageJson.version ?? '0.0.0',
      'bom-ref': `pkg:npm/${packageJson.name}@${packageJson.version}`,
    },
    tools: [{
      vendor: 'RDC-Agent',
      name: 'generate-sbom.mjs',
      version: '0.1.0',
    }],
  },
  components,
};

const releaseDir = path.join(repoRoot, 'release');
mkdirSync(releaseDir, { recursive: true });
const outPath = path.join(releaseDir, 'sbom.cdx.json');
const serialized = `${JSON.stringify(bom, null, 2)}\n`;
writeFileSync(outPath, serialized, 'utf8');
const digest = createHash('sha256').update(serialized).digest('hex');
writeFileSync(`${outPath}.sha256`, `${digest}  sbom.cdx.json\n`, 'utf8');
console.log(`[release:sbom] Wrote ${path.relative(repoRoot, outPath)} (${components.length} components, sha256=${digest.slice(0, 12)}…)`);
