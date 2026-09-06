#!/usr/bin/env node
/**
 * Renderer structure gate: dependency direction, feature isolation, IPC access
 * layering, and retired technology buckets. Complements check-architecture.mjs
 * (line budgets / hex) with the target-state module graph from
 * docs/ui/design-system.md and DESIGN.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDebtRatchet, assertContractIntegrity } from './renderer-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let hitCount = 0;
const fail = (message) => {
  console.error(`[renderer-structure] ${message}`);
  hitCount += 1;
};

const rendererRoot = path.join(root, 'src/renderer');

const walk = (dir, files = []) => {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
};

const importPaths = (content) => {
  const paths = [];
  const re = /from\s+['"]([^'"]+)['"]/g;
  let match = re.exec(content);
  while (match) {
    paths.push(match[1]);
    match = re.exec(content);
  }
  return paths;
};

const layerOf = (rel) => {
  const match = rel.match(/^src\/renderer\/([^/]+)\//);
  return match ? match[1] : '(root)';
};

const featureOf = (rel) => {
  const match = rel.match(/^src\/renderer\/features\/([^/]+)\//);
  return match ? match[1] : null;
};

// Allowed imports per layer (target-state graph).
const LAYER_RULES = {
  ui: { deny: ['features', 'stores', 'platform', 'app', 'shell', 'hooks', 'services', 'patterns'] },
  lib: { deny: ['features', 'stores', 'platform', 'app', 'shell', 'ui', 'patterns', 'services'] },
  // patterns/ is the product-composite layer: it may read stores (see
  // src/renderer/patterns/README.md) but must not reach into features or the
  // app/shell chrome, and must not touch IPC directly.
  patterns: { deny: ['features', 'platform', 'app', 'shell'] },
  stores: { deny: ['features', 'app', 'shell', 'ui', 'patterns'] },
  services: { deny: ['features', 'app', 'shell', 'ui', 'patterns'] },
  hooks: { deny: ['features', 'app', 'shell', 'ui', 'patterns'] },
  shell: { deny: ['features'] },
  app: { deny: [] },
  features: { deny: ['app', 'shell'] },
};

const resolveImport = (fromRel, importPath) => {
  if (importPath.startsWith('@shared')) return { layer: '(shared)' };
  if (!importPath.startsWith('.')) return { layer: '(external)' };
  const fromDir = path.posix.dirname(fromRel);
  const resolved = path.posix.normalize(path.posix.join(fromDir, importPath));
  return { layer: layerOf(`${resolved}/`), feature: featureOf(`${resolved}/`), rel: resolved };
};

const files = walk(rendererRoot);

for (const filePath of files) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const layer = layerOf(rel);
  const feature = featureOf(rel);
  const rules = LAYER_RULES[layer];

  for (const imp of importPaths(content)) {
    const resolved = resolveImport(rel, imp);
    if (resolved.layer === '(shared)' || resolved.layer === '(external)') continue;

    if (rules && rules.deny.includes(resolved.layer)) {
      fail(`${rel}: layer "${layer}" must not import "${resolved.layer}" (${imp})`);
    }

    if (layer === 'features' && resolved.layer === 'features' && feature && resolved.feature && feature !== resolved.feature) {
      fail(`${rel}: cross-feature import is forbidden (${feature} -> ${resolved.feature} via ${imp})`);
    }
  }

  // IPC access layering: only platform/, stores/, services/, and feature data
  // hooks/modules (*.ts, not *.tsx) may touch window.electronAPI / getElectronApi.
  if (/window\.electronAPI|getElectronApi\(/.test(content)) {
    const isTsx = rel.endsWith('.tsx');
    const allowedLayer = ['platform', 'stores', 'services', 'hooks', 'app'].includes(layer);
    const isFeatureModule = layer === 'features' && !isTsx;
    if (isTsx && !rel.startsWith('src/renderer/platform/')) {
      fail(`${rel}: components must not touch window.electronAPI / getElectronApi directly (use a store, service, or feature data hook)`);
    } else if (!allowedLayer && !isFeatureModule) {
      fail(`${rel}: layer "${layer}" must not access IPC directly`);
    }
  }

  // State naming convergence: legacy selected-state classes must not return.
  if (rel.endsWith('.tsx') && /className=\{?['"`][^'"`]*\b(active|current)\b/.test(content)) {
    fail(`${rel}: use is-* state classes (is-active / is-selected), not bare .active / .current`);
  }
}

// Retired technology buckets.
for (const retired of ['src/renderer/pages', 'src/renderer/components', 'src/renderer/styles/base']) {
  if (fs.existsSync(path.join(root, retired))) {
    fail(`retired bucket must remain deleted: ${retired}`);
  }
}

// CSS colocation: feature components must not be styled from styles/global.
for (const globalCss of ['src/renderer/styles/global/app-shell.css', 'src/renderer/styles/global/panels-composer.css']) {
  const absolute = path.join(root, globalCss);
  if (!fs.existsSync(absolute)) continue;
  const content = fs.readFileSync(absolute, 'utf8');
  for (const forbiddenPrefix of ['.composer-', '.settings-', '.knowledge-center-', '.right-rail-', '.work-process-', '.session-item', '.sidebar-']) {
    if (content.includes(forbiddenPrefix)) {
      fail(`${globalCss}: feature selector "${forbiddenPrefix}" must live in the owning feature directory, not styles/global`);
    }
  }
}

assertContractIntegrity(fail);

applyDebtRatchet({
  id: 'renderer-structure',
  hits: hitCount,
  baselineRel: 'scripts/fidelity/renderer-structure-baseline.json',
});
