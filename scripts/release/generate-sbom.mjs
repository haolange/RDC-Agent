#!/usr/bin/env node
/**
 * CycloneDX SBOM from the complete pnpm-lock.yaml transitive graph.
 * Writes release/sbom.cdx.json and release/sbom.cdx.json.sha256.
 * Provenance (git SHA, lockfile digest) is recorded in metadata.properties.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const lockPath = path.join(repoRoot, 'pnpm-lock.yaml');
if (!existsSync(lockPath)) {
  console.error('[release:sbom] pnpm-lock.yaml is required for a complete SBOM.');
  process.exit(1);
}

const lockText = readFileSync(lockPath, 'utf8');
const lockDigest = createHash('sha256').update(lockText).digest('hex');

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return process.env.GITHUB_SHA?.trim() || 'unknown';
  }
}

function parseLockfilePackages(text) {
  const packagesIndex = text.search(/^packages:\s*$/m);
  if (packagesIndex < 0) {
    throw new Error('pnpm-lock.yaml is missing a packages: section');
  }
  const body = text.slice(packagesIndex);
  const components = [];
  const seen = new Set();
  const keyRe = /^ {2}(?:'([^']+)'|([^:\s]+)):/gm;
  let match;
  while ((match = keyRe.exec(body))) {
    const key = match[1] || match[2];
    if (!key || key === 'packages') continue;
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (!name || !version) continue;
    const purl = name.startsWith('@')
      ? 'pkg:npm/' + name.replace('/', '%2F') + '@' + version
      : 'pkg:npm/' + name + '@' + version;
    if (seen.has(purl)) continue;
    seen.add(purl);
    components.push({
      type: 'library',
      name,
      version,
      purl,
      'bom-ref': purl,
    });
  }
  return components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const components = parseLockfilePackages(lockText);
if (components.length < 50) {
  console.error('[release:sbom] lockfile graph too small (' + components.length + '); expected transitive packages.');
  process.exit(1);
}

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
      'bom-ref': 'pkg:npm/' + packageJson.name + '@' + packageJson.version,
    },
    tools: [{
      vendor: 'RDC-Agent',
      name: 'generate-sbom.mjs',
      version: '0.2.0',
    }],
    properties: [
      { name: 'rdc:gitSha', value: gitSha() },
      { name: 'rdc:lockfile', value: 'pnpm-lock.yaml' },
      { name: 'rdc:lockfileSha256', value: lockDigest },
      { name: 'rdc:platform', value: 'win32' },
    ],
  },
  components,
};

const releaseDir = path.join(repoRoot, 'release');
mkdirSync(releaseDir, { recursive: true });
const outPath = path.join(releaseDir, 'sbom.cdx.json');
const serialized = JSON.stringify(bom, null, 2) + '\n';
writeFileSync(outPath, serialized, 'utf8');
const digest = createHash('sha256').update(serialized).digest('hex');
writeFileSync(outPath + '.sha256', digest + '  sbom.cdx.json\n', 'utf8');
console.log('[release:sbom] Wrote ' + path.relative(repoRoot, outPath) + ' (' + components.length + ' components, sha256=' + digest.slice(0, 12) + ')');
