#!/usr/bin/env node
// UI contract gate: the measurable half of docs/ui/design-system.md「审美契约」.
// Each rule counts violations across the renderer and fails when a count exceeds its ceiling.
// Ceilings only move down; the resync finishes with every ceiling at 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = path.join(repoRoot, 'src/renderer');

const CEILINGS = {
  'invalid-transition': 0,
  'inline-svg': 0,
  'text-glyph': 0,
  'raw-error-render': 0,
  'literal-color': 3,
  'i18n-same-value': 24,
  'bare-alert': 7,
};

/** Proper nouns stay English in every locale: Agent and mode names, product names, RenderDoc and protocol terms. */
const PROPER_NOUNS = new Set([
  'Ask', 'Plan', 'Edit', 'Debugger', 'Analyzer', 'Optimizer', 'General', 'Verifier', 'Agent',
  'Max', 'Fast', 'English', 'RDC', 'RDC-Tool', 'RDC-Agent', 'RenderDoc', 'Git', 'MCP', 'API', 'LLM', 'GPU',
  'Capture', 'Swapchain', 'Present', 'Texture', 'RT', 'SKILL.md', '.gitignore',
]);

/** Token and motion definition layers may hold literal values; components may not. */
const STYLE_DEFINITION_FILES = new Set([
  'src/renderer/styles/design-system.css',
  'src/renderer/styles/design-tokens.css',
  'src/renderer/styles/design-motion.css',
  'src/renderer/styles/design-base.css',
  'src/renderer/styles/design-reduced-motion.css',
]);

/** SVG that is not an icon: the registry itself, Agent identity glyphs, filled status markers, empty-state art,
 *  the context usage ring and material region overlays. */
const SVG_OWNERS = [
  /^src\/renderer\/ui\/Icon\.tsx$/,
  /^src\/renderer\/ui\/ModeGlyph\.tsx$/,
  /^src\/renderer\/ui\/TaskStatusMarker\//,
  /EmptyVisuals\.tsx$/,
  /^src\/renderer\/patterns\/ContextUsageIndicator\.tsx$/,
  /^src\/renderer\/patterns\/MaterialContext(?:Editor|Viewer)\.tsx$/,
];

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name);
  if (entry.isDirectory()) return walk(full);
  return [full];
});

const relative = (file) => path.relative(repoRoot, file).split(path.sep).join('/');
const isTest = (file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
const files = walk(rendererRoot).map(relative).filter((file) => !isTest(file));
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Splits a CSS value on top-level commas so `transition: a, b` yields one segment per property. */
function topLevelSegments(value) {
  const segments = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  segments.push(current);
  return segments;
}

const EASING = /var\(--(?:ease|transition|motion)-[a-z-]+\)|\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b|cubic-bezier\(|steps\(/g;

function invalidTransitions() {
  const findings = [];
  for (const file of files.filter((name) => name.endsWith('.css') && !STYLE_DEFINITION_FILES.has(name))) {
    const text = read(file);
    for (const match of text.matchAll(/\b(transition|animation)\s*:\s*([^;]+);/g)) {
      for (const segment of topLevelSegments(match[2])) {
        // --transition-* and --motion-* already carry a duration and an easing.
        const easings = segment.match(EASING) ?? [];
        if (easings.length > 1) findings.push(`${file}:${lineOf(text, match.index)} ${segment.trim()}`);
      }
    }
  }
  return findings;
}

function inlineSvg() {
  const findings = [];
  for (const file of files.filter((name) => name.endsWith('.tsx') && !SVG_OWNERS.some((owner) => owner.test(name)))) {
    const text = read(file);
    for (const match of text.matchAll(/<svg\b/g)) findings.push(`${file}:${lineOf(text, match.index)}`);
  }
  // The chevron glyph is reachable only through ui/Chevron, which owns direction and the disclosure rotation.
  for (const file of files.filter((name) => /\.tsx?$/.test(name) && !/^src\/renderer\/ui\/(?:Chevron\.tsx|icons\/)/.test(name))) {
    const text = read(file);
    for (const match of text.matchAll(/['"]chevron-(?:right|left|up|down)['"]/g)) findings.push(`${file}:${lineOf(text, match.index)} ${match[0]}`);
  }
  return findings;
}

const GLYPHS = '✓✔✗✕×⧉‹›«»↻⟳⋯ⓘ▸▾▶◀▲▼→←';
function textGlyphs() {
  const findings = [];
  const jsxGlyph = new RegExp(`>\\s*[${GLYPHS}]\\s*<`, 'g');
  const literalGlyph = new RegExp(`(['"\`])[${GLYPHS}]\\1`, 'g');
  const textIcons = /(['"`])(?:SKL|IMG|TXT|PDF|FILE)\1/g;
  for (const file of files.filter((name) => /\.tsx?$/.test(name) && !name.includes('/i18n/'))) {
    const text = read(file);
    for (const pattern of [jsxGlyph, literalGlyph, textIcons]) {
      for (const match of text.matchAll(pattern)) findings.push(`${file}:${lineOf(text, match.index)} ${match[0].trim()}`);
    }
  }
  return findings;
}

function rawErrorRender() {
  const findings = [];
  const patterns = [/String\((?:error|err|reason|cause|e|failure)\)/g, /\{\s*(?:error|err|e|reason|failure)\.message\s*\}/g];
  for (const file of files.filter((name) => name.endsWith('.tsx'))) {
    const text = read(file);
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) findings.push(`${file}:${lineOf(text, match.index)} ${match[0]}`);
    }
  }
  return findings;
}

/** Color pickers paint the color space itself, so their gradients are literal by nature. */
const COLOR_SPACE_FILES = new Set(['src/renderer/ui/ColorPickerSurface.css']);

/** An alert is the unified InlineError, or at least a styled element; a bare <p role="alert"> prints raw text unstyled. */
function bareAlerts() {
  const findings = [];
  for (const file of files.filter((name) => name.endsWith('.tsx') && name !== 'src/renderer/ui/InlineError.tsx')) {
    const text = read(file);
    for (const match of text.matchAll(/<(p|div|span|small)\s+role="alert"/g)) findings.push(`${file}:${lineOf(text, match.index)}`);
  }
  return findings;
}

function literalColors() {
  const findings = [];
  const pattern = /:\s*[^;{}]*?(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bwhite\b|\bblack\b)/g;
  for (const file of files.filter((name) => name.endsWith('.css') && !STYLE_DEFINITION_FILES.has(name) && !COLOR_SPACE_FILES.has(name))) {
    // Mask images encode opacity, not color, so their black and white stops are not theme colors.
    const text = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
      .replace(/(?:-webkit-)?mask(?:-image)?\s*:[^;]*;/g, (declaration) => declaration.replace(/[^\n]/g, ' '));
    for (const match of text.matchAll(pattern)) {
      // Custom-property names such as --token-text-white are names, not literal colors.
      if (/--[\w-]*$/.test(match[0].slice(0, match[0].length - match[1].length))) continue;
      findings.push(`${file}:${lineOf(text, match.index)} ${match[1]}`);
    }
  }
  return findings;
}

/** Preserved design assets: each must keep its defining hook so a refactor cannot drop it silently. */
function preservedAssets() {
  const css = files.filter((name) => name.endsWith('.css')).map(read).join('\n');
  const checks = [
    ['Active Signal shimmer keyframes', /@keyframes\s+active-signal-shimmer\b/.test(css)],
    ['Composer energy orbit keyframes', /@keyframes\s+composerEnergyOrbit\b/.test(css)],
    ['Max particle field', fs.existsSync(path.join(rendererRoot, 'features/composer/EffortMaxField.tsx'))],
    ['Subagent progress dots animation', /\.work-process-subagent-dots[^{]*\{[^}]*animation/.test(css) || /work-process-subagent-dots[\s\S]{0,400}animation/.test(css)],
    ['Thinking duration label', [...parseLocale('zh-CN').values()].some((value) => value.startsWith('已思考 · '))],
  ];
  return checks.filter(([, present]) => !present).map(([name]) => name);
}

function parseLocale(locale) {
  const directory = path.join(rendererRoot, 'i18n/locales', locale);
  const entries = new Map();
  for (const name of fs.readdirSync(directory)) {
    const text = fs.readFileSync(path.join(directory, name), 'utf8');
    for (const match of text.matchAll(/^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/gm)) {
      entries.set(match[1], match[2] ?? match[3] ?? match[4]);
    }
  }
  return entries;
}

/** A key whose Chinese and English text match is untranslated unless every word in it is a proper noun. */
function i18nSameValues() {
  const english = parseLocale('en');
  const findings = [];
  for (const [key, value] of parseLocale('zh-CN')) {
    if (english.get(key) !== value) continue;
    const words = value.replace(/\{[^}]+\}/g, ' ').split(/[\s·/→,:%()+-]+/).filter((word) => /[A-Za-z]/.test(word));
    if (words.length === 0 || words.every((word) => PROPER_NOUNS.has(word))) continue;
    findings.push(`${key} = ${JSON.stringify(value)}`);
  }
  return findings;
}

const results = {
  'invalid-transition': invalidTransitions(),
  'inline-svg': inlineSvg(),
  'text-glyph': textGlyphs(),
  'raw-error-render': rawErrorRender(),
  'literal-color': literalColors(),
  'i18n-same-value': i18nSameValues(),
  'bare-alert': bareAlerts(),
};

const verbose = process.argv.includes('--verbose');
let failed = false;
for (const [rule, findings] of Object.entries(results)) {
  const ceiling = CEILINGS[rule];
  const status = findings.length > ceiling ? 'FAIL' : 'ok';
  if (findings.length > ceiling) failed = true;
  console.log(`[ui-contract] ${status} ${rule}: ${findings.length} (ceiling ${ceiling})`);
  if (verbose || findings.length > ceiling) for (const finding of findings) console.log(`  ${finding}`);
  if (findings.length < ceiling) console.log(`  lower the ${rule} ceiling to ${findings.length}`);
}
const missing = preservedAssets();
for (const asset of missing) console.log(`[ui-contract] FAIL preserved asset missing: ${asset}`);
if (missing.length > 0) failed = true;
if (failed) process.exit(1);
console.log('[ui-contract] OK');
