#!/usr/bin/env node
/**
 * Design-token compliance gate for renderer CSS.
 *
 * Rules (see docs/ui/design-system.md):
 *  - feature / ui / patterns / shell CSS must reference semantic tokens
 *    (`--token-*`, `--type-*`, `--space-*`, `--radius-*`, `--control-*`, component vars)
 *    instead of primitive `--color-*` namespaces or literal values.
 *  - token definition file (design-system.css) may reference primitives.
 *    styles/global/* is not exempt.
 *  - Right Rail empty visuals use semantic `--token-*` stop-color classes.
 *  - component CSS may only set backdrop-filter to var(--modal-backdrop-filter);
 *    literal blur() stays in the token definition file.
 *  - font-size uses a typography role (no em, rem or px); line-height and letter-spacing use the --type-*-line,
 *    --leading-* and --tracking-* scales (0, normal and inherit are resets, not values).
 *  - media queries use only the widths in styles/global/breakpoints.css.
 *  - every var(--name) without a fallback names a custom property something defines: renderer CSS, a renderer
 *    script that sets it at runtime (useDynStyle, the Appearance compiler), or src/shared/theme. A reference to a
 *    name nothing defines is invalid at computed time and silently inherits (--font-regular kept weight 600).
 *
 * Any hit fails the gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireZeroHits } from './renderer-contract.mjs';
import { stripCssComments } from './lib/cssRules.mjs';

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
  'src/renderer/styles/design-tokens.css',
  'src/renderer/styles/design-motion.css',
  'src/renderer/styles/design-base.css',
  'src/renderer/styles/design-reduced-motion.css',
];

const isExempt = (rel) => EXEMPT_PREFIXES.some((prefix) => (
  prefix.endsWith('/') ? rel.startsWith(prefix) : rel === prefix
));

const STOP_COLOR_EXEMPT = new Set();

/**
 * Hits the stricter typography rules found in files another change owns at the moment, counted per file. A count may
 * only fall: more hits fail, fewer print the number to lower it to, and an entry leaves this map at 0.
 */
const PENDING_OWNER_FIXES = {
  'src/renderer/features/composer/ComposerMarkdownInput.css': 1,
  'src/renderer/features/composer/composer-agent-popup.css': 1,
  'src/renderer/features/composer/composer-editor.css': 1,
  'src/renderer/features/composer/composer-pending-requests.css': 2,
  'src/renderer/features/composer/composer-permission-options.css': 1,
  'src/renderer/features/composer/composer-permission.css': 1,
  'src/renderer/features/composer/composer-usage.css': 1,
  'src/renderer/features/composer/composer-user-input.css': 2,
  'src/renderer/features/transcript/AgentChat.markdown.css': 8,
  'src/renderer/features/transcript/message-bubbles.css': 5,
  'src/renderer/features/transcript/message-editor.css': 2,
  'src/renderer/features/transcript/message-layout.css': 1,
  'src/renderer/features/transcript/work-process-answers.css': 3,
  'src/renderer/features/transcript/work-process-decisions.css': 1,
  'src/renderer/features/transcript/work-process-families.css': 1,
  'src/renderer/features/transcript/work-process-layout.css': 5,
  'src/renderer/features/transcript/work-process-tasks.css': 2,
  'src/renderer/features/transcript/work-process-thinking.css': 4,
  'src/renderer/features/transcript/work-process-tool-cards.css': 7,
  'src/renderer/features/transcript/work-process-web.css': 1,
};

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
    id: 'font-size-role',
    pattern: /font-size:(?!\s*(?:var\(--type-(?:title|reading|body|meta)-size\)|var\(--[a-z-]+-font-size\)|inherit\b|100%))/,
    message: 'font-size must use one of the four typography roles var(--type-title|reading|body|meta-size); no em, rem or px',
  },
  {
    id: 'raw-type-scale',
    pattern: /var\(--text-[a-z0-9]+\)/,
    message: 'the raw --text-* scale is gone; use a typography role var(--type-*-size)',
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
];

const BACKDROP_FILTER_DECL = /(?:-webkit-)?backdrop-filter:\s*([^;]+)/g;

/** line-height and letter-spacing: a literal number or length outside var() is off the scale. */
const SCALED_PROPERTIES = [
  { id: 'line-height-literal', property: 'line-height', message: 'line-height must use var(--type-*-line) or var(--leading-*)' },
  { id: 'letter-spacing-literal', property: 'letter-spacing', message: 'letter-spacing must use var(--tracking-*)' },
];
const isOffScale = (value) => {
  const literal = value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '').trim();
  return !/^(?:0|normal|inherit)?$/.test(literal) && /\d/.test(literal);
};

/** The breakpoint table (styles/global/breakpoints.css): the only widths a media query may name. */
const BREAKPOINTS = new Set([1280, 1100, 960, 920, 720, 640, 480]);
const MEDIA_WIDTH = /(?:(?:min|max)-width\s*:\s*|width\s*[<>]=?\s*)([\d.]+)(px|rem|em)\b/g;

const rendererScripts = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) rendererScripts(fullPath, files);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(fullPath);
  }
  return files;
};

/** Custom properties something defines: declared in renderer CSS or named as a string in a script that sets it. */
function definedCustomProperties(cssFiles) {
  const names = new Set();
  for (const file of cssFiles) {
    const text = stripCssComments(fs.readFileSync(file, 'utf8'));
    for (const match of text.matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1]);
    for (const match of text.matchAll(/@property\s+(--[\w-]+)/g)) names.add(match[1]);
  }
  for (const file of [...rendererScripts(path.join(root, 'src/renderer')), ...rendererScripts(path.join(root, 'src/shared/theme'))]) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/['"`](--[\w-]+)/g)) names.add(match[1]);
  }
  return names;
}

const files = walk(path.join(root, 'src/renderer'));
const hits = [];
const defined = definedCustomProperties(files);

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
      hits.push(`${rel}:${index + 1}: ${rule.id} — ${rule.message} :: ${line.trim()}`);
    }
    for (const { id, property, message } of SCALED_PROPERTIES) {
      for (const match of line.matchAll(new RegExp(`(?:^|[\\s{;])${property}\\s*:\\s*([^;}]+)`, 'g'))) {
        if (isOffScale(match[1])) hits.push(`${rel}:${index + 1}: ${id} — ${message} :: ${line.trim()}`);
      }
    }
    if (/^\s*@media\b/.test(line)) {
      for (const match of line.matchAll(MEDIA_WIDTH)) {
        const px = Number(match[1]) * (match[2] === 'px' ? 1 : 16);
        if (!BREAKPOINTS.has(px)) hits.push(`${rel}:${index + 1}: breakpoint — media width ${match[1]}${match[2]} is not in the breakpoint table (${[...BREAKPOINTS].join(' / ')}px) :: ${line.trim()}`);
      }
    }
    BACKDROP_FILTER_DECL.lastIndex = 0;
    let backdropMatch;
    while ((backdropMatch = BACKDROP_FILTER_DECL.exec(line))) {
      const value = backdropMatch[1].trim();
      if (value === 'var(--modal-backdrop-filter)') continue;
      hits.push(`${rel}:${index + 1}: backdrop-blur — backdrop-filter must be var(--modal-backdrop-filter) :: ${line.trim()}`);
    }
  });
}

// Undefined references are checked everywhere, the token layer included: a typo there breaks every consumer.
for (const filePath of files) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  const text = stripCssComments(fs.readFileSync(filePath, 'utf8'));
  for (const match of text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
    if (defined.has(match[1])) continue;
    const line = text.slice(0, match.index).split('\n').length;
    hits.push(`${rel}:${line}: undefined-var — ${match[1]} is defined nowhere, so the declaration is invalid and inherits :: ${match[0]}`);
  }
}

const fileOf = (hit) => hit.slice(0, hit.indexOf(':'));
const pendingCounts = new Map();
for (const hit of hits) {
  const file = fileOf(hit);
  if (Object.hasOwn(PENDING_OWNER_FIXES, file)) pendingCounts.set(file, (pendingCounts.get(file) ?? 0) + 1);
}
const failing = hits.filter((hit) => {
  const file = fileOf(hit);
  return !Object.hasOwn(PENDING_OWNER_FIXES, file) || pendingCounts.get(file) > PENDING_OWNER_FIXES[file];
});
for (const [file, allowed] of Object.entries(PENDING_OWNER_FIXES)) {
  const count = pendingCounts.get(file) ?? 0;
  if (count < allowed) console.log(`[design-tokens] pending ${file}: ${count} hit(s); lower its PENDING_OWNER_FIXES entry to ${count}`);
}
const pendingTotal = [...pendingCounts.values()].reduce((sum, count) => sum + count, 0);
if (pendingTotal > 0) console.log(`[design-tokens] ${pendingTotal} pending hit(s) in ${pendingCounts.size} file(s) owned by another change`);

const verbose = process.argv.includes('--verbose');
const shown = verbose ? hits : failing;
for (const hit of shown.slice(0, verbose ? shown.length : 60)) {
  console.error(`[design-tokens] ${hit}`);
}
if (!verbose && failing.length > 60) {
  console.error(`[design-tokens] ... and ${failing.length - 60} more hit(s)`);
}

if (failing.length > 0) {
  console.error(`[design-tokens] ${failing.length} hit(s)`);
}

requireZeroHits({ id: 'design-tokens', hits: failing.length });
