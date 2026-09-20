#!/usr/bin/env node
/**
 * Generate SHA-256 checksums for artifacts under release/ when present.
 * Writes release/SHA256SUMS.txt (GNU coreutils style).
 * Supports both installer artifacts and electron-builder --dir unpacked trees.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releaseDir = path.join(repoRoot, 'release');
const outputName = 'SHA256SUMS.txt';
const hasDistribution = existsSync(releaseDir)
  && readdirSync(releaseDir).some(name => /\.(exe|zip|dmg|AppImage|deb|rpm|msi|pkg)$/i.test(name));

function hashFile(absolute, relative) {
  const digest = createHash('sha256').update(readFileSync(absolute)).digest('hex');
  return { digest, relative: relative.replaceAll('\\', '/') };
}

function listArtifactFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === outputName || name.endsWith('.sha256') || name === 'sbom.cdx.json' || name === 'builder-debug.yml') continue;
    const absolute = path.join(dir, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if (
        name.endsWith('-unpacked')
        || name === 'mac'
        || name === 'mac-arm64'
        || name === 'win-unpacked'
        || name === 'linux-unpacked'
      ) {
        if (hasDistribution) continue; // Public checksum list must not reference local-only unpacked files.
        // --dir packs: hash the primary executable inside unpacked trees.
        const candidates = [
          path.join(absolute, 'RdcAgent.exe'),
          path.join(absolute, 'RdcAgent'),
          path.join(absolute, 'RdcAgent.app', 'Contents', 'MacOS', 'RdcAgent'),
        ];
        for (const candidate of candidates) {
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            entries.push(hashFile(candidate, path.relative(releaseDir, candidate)));
          }
        }
        continue;
      }
      entries.push(...listArtifactFiles(absolute, relative));
      continue;
    }
    if (!stats.isFile()) continue;
    if (
      /\.(exe|dmg|AppImage|zip|blockmap|yml|yaml|deb|rpm|msi|pkg|7z|tar\.gz)$/i.test(name)
      || name === 'latest.yml'
      || name === 'latest-mac.yml'
      || name === 'latest-linux.yml'
    ) {
      entries.push(hashFile(absolute, relative));
    }
  }
  return entries;
}

if (!existsSync(releaseDir)) {
  console.log('[release:checksums] release/ missing — nothing to hash.');
  process.exit(0);
}

const artifacts = listArtifactFiles(releaseDir);
if (artifacts.length === 0) {
  console.error('[release:checksums] No pack/dist artifacts under release/.');
  process.exitCode = 1;
  process.exit(1);
}

const lines = artifacts.map(({ digest, relative }) => `${digest}  ${relative}`);
writeFileSync(path.join(releaseDir, outputName), `${lines.join('\n')}\n`, 'utf8');
console.log(`[release:checksums] Wrote ${artifacts.length} checksum(s) to release/${outputName}`);
