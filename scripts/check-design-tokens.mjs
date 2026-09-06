#!/usr/bin/env node
/**
 * Design-token compliance gate for renderer CSS.
 *
 * Rules (see docs/ui/design-system.md):
 *  - feature / ui / patterns / shell CSS must reference semantic tokens
 *    (`--token-*`, `--text-*`, `--space-*`, `--radius-*`, `--control-*`, component vars)
 *    instead of primitive `--color-*` namespaces or literal values.
 *  - token definition file (design-system.css) may reference primitives.
 *    styles/global/* is not exempt; reduced-motion !important in base.css is
 *    the single documented exception.
 *  - SVG presentation-attribute injection for the Right Rail empty visuals is the
 *    single documented exception for `stop-color` primitives (scoped to that file).
 *
 * Hits are locked by scripts/fidelity/design-tokens-baseline.json (B0 ratchet).
 * Debt may only decrease; a decrease must update the baseline in the same change.
 * B1 sets the baseline to 0, after which any hit fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDebtRatchet } from './renderer-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir, files = []) => {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.name.endsWith('.css')) files.push(fullPath);
  }
  return files;
};

// Token definition layer may reference primitives.
const EXEMPT_PREFIXES = [
  'src/renderer/styles/design-system.css',
];

const isExempt = (rel) => EXEMPT_PREFIXES.some((prefix) => (
  prefix.endsWith('/') ? rel.startsWith(prefix) : rel === prefix
));

// Right Rail empty visuals inject SVG stop colors via presentation attributes;
// documented single exception (docs/ui/design-system.md 空态插画).
const STOP_COLOR_EXEMPT = new Set([
  'src/renderer/features/debugger/ControlPanel/RightRail.css',
]);

const RULES = [
  {
    id: 'primitive-color-var',
    pattern: /var\(--color-[a-z0-9-]+\)/i,
    message: 'use semantic --token-* instead of primitive --color-*',
  },
  {
    id: 'hex-literal',
    pattern: /#[0-9a-fA-F]{3,8}\b/,
    message: 'hardcoded hex color; use design tokens',
  },
  {
    id: 'font-size-px',
    pattern: /font-size:\s*\d+(?:\.\d+)?px/,
    message: 'font-size must use var(--text-*)',
  },
  {
    id: 'spacing-px',
    pattern: /(?:^|[\s{;])(?:gap|row-gap|column-gap|padding|padding-top|padding-right|padding-bottom|padding-left|padding-inline|padding-inline-start|padding-inline-end|padding-block|margin|margin-top|margin-right|margin-bottom|margin-left|margin-inline|margin-inline-start|margin-inline-end|margin-block):\s*[^;]*\d+(?:\.\d+)?px/,
    message: 'spacing must use var(--space-*)',
  },
  {
    id: 'radius-px',
    pattern: /border-radius:\s*[^;]*\d+(?:\.\d+)?px/,
    message: 'border-radius must use var(--radius-*) / component radius vars',
  },
  {
    id: 'important',
    pattern: /!important/,
    message: '!important is forbidden in component CSS',
  },
  {
    id: 'backdrop-blur',
    pattern: /backdrop-filter:\s*blur|-webkit-backdrop-filter:\s*blur/,
    message: 'backdrop blur is forbidden (restrained chrome uses solid surfaces)',
  },
];

const files = walk(path.join(root, 'src/renderer'));
const hits = [];

for (const filePath of files) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  if (isExempt(rel)) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(line)) continue;
      if (rule.id === 'primitive-color-var' && STOP_COLOR_EXEMPT.has(rel) && line.includes('stop-color')) continue;
      if (rule.id === 'important' && rel === 'src/renderer/styles/global/base.css') {
        continue;
      }
      hits.push(`${rel}:${index + 1}: ${rule.id} — ${rule.message} :: ${line.trim()}`);
    }
  });
}

for (const hit of hits.slice(0, 60)) {
  console.error(`[design-tokens] ${hit}`);
}
if (hits.length > 60) {
  console.error(`[design-tokens] ... and ${hits.length - 60} more hit(s)`);
}

if (hits.length > 0) {
  console.error(`[design-tokens] current debt ${hits.length} hit(s)`);
}

applyDebtRatchet({
  id: 'design-tokens',
  hits: hits.length,
  baselineRel: 'scripts/fidelity/design-tokens-baseline.json',
});
