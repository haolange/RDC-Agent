#!/usr/bin/env node
// UI contract gate: the measurable half of docs/ui/design-system.md「审美契约」.
// Each rule counts violations across the renderer and fails when a count exceeds its ceiling.
// Ceilings only move down; the resync finishes with every ceiling at 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readCssRules, readDeclarations, splitTopLevel } from './lib/cssRules.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = path.join(repoRoot, 'src/renderer');

// Non-zero ceilings below count hits in files another change owns at the moment (transcript, composer); the
// report names each one. They fall to 0 when those files are fixed.
const CEILINGS = {
  'invalid-transition': 0,
  'inline-svg': 0,
  'text-glyph': 0,
  'raw-error-render': 0,
  'literal-color': 0,
  'bare-alert': 0,
  // Pending in transcript CSS: message-actions, work-process-disclosure (2) and work-process-web.
  'hover-focus-pair': 4,
  'focus-same-as-hover': 0,
  'reduced-motion': 0,
  // Pending: MeasuredWorkRows asks lib/motion instead of scrolling smoothly unconditionally.
  'smooth-scroll': 1,
  // Pending: ComposerModelEffortPanel, ComposerSkillChips, SubagentCallDetails, WorkProcessFamilyLayers (4),
  // WorkProcessToolCardParts (4) and WorkProcessWebParts.
  'tooltip-target': 12,
};

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

/**
 * An alert is the unified InlineError, or at least a styled element; a bare text element with role="alert" (no class)
 * prints raw text unstyled. The role counts wherever it sits among the attributes and in string or expression form.
 */
const ALERT_TEXT_TAGS = new Set(['p', 'div', 'span', 'small', 'strong', 'em', 'li', 'section']);
function bareAlerts() {
  const findings = [];
  for (const file of files.filter((name) => name.endsWith('.tsx') && name !== 'src/renderer/ui/InlineError.tsx')) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
        const value = (attr) => {
          const init = attr.initializer;
          if (init && ts.isStringLiteral(init)) return init.text;
          const expression = init && ts.isJsxExpression(init) ? init.expression : undefined;
          return expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) ? expression.text : null;
        };
        const isAlert = attrs.some((attr) => attr.name.getText() === 'role' && value(attr) === 'alert');
        const styled = attrs.some((attr) => attr.name.getText() === 'className');
        if (ALERT_TEXT_TAGS.has(node.tagName.getText()) && isAlert && !styled) {
          findings.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

const componentCss = files.filter((name) => name.endsWith('.css') && !STYLE_DEFINITION_FILES.has(name));
const allCssRules = files.filter((name) => name.endsWith('.css'))
  .flatMap((file) => readCssRules(read(file)).map((rule) => ({ ...rule, file })));

/** Compound selectors of one complex selector: `.a:hover > .b .c` yields `.a:hover`, `.b`, `.c`. */
const compoundsOf = (selector) => {
  const compounds = [];
  let depth = 0;
  let current = '';
  for (const character of selector) {
    if (character === '(' || character === '[') depth += 1;
    if (character === ')' || character === ']') depth -= 1;
    if (depth === 0 && /[\s>+~]/.test(character)) {
      if (current) compounds.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) compounds.push(current);
  return compounds;
};
const FOCUS = /:focus(?:-visible|-within)?\b/;
/**
 * The simple selectors naming the element a selector styles (its last compound), state pseudo-classes removed:
 * `.ui-checkbox:hover .ui-checkbox-box` → [`.ui-checkbox-box`], `.icon-button:hover:not(:disabled)` → [`.icon-button`].
 */
const subjectOf = (selector) => (compoundsOf(selector).at(-1) ?? '')
  .replace(/::?[-\w]+\((?:[^()]|\([^()]*\))*\)/g, '')
  .replace(/::?[-\w]+/g, '')
  .match(/[.#]?[-\w]+|\[[^\]]*\]/g) ?? [];

/** Hover-only by nature: scrollbar thumbs and the aria-hidden drag handles of resizable panels. */
const POINTER_ONLY = [/::-webkit-scrollbar/, /^\.panel-resize-handle\b/, /^\.runtime-terminal-resize-handle\b/];

/** Every :hover needs a keyboard counterpart on the same element: :focus-visible, :focus-within or :focus. */
function hoverFocusPairs() {
  // A focus rule covers a hovered element when it styles the same element: its subject's simple selectors are a
  // subset of the hovered subject's (`.ui-list-row:focus-visible` covers `.ui-list-row.is-selected:hover`).
  const focusSubjects = allCssRules.flatMap((rule) => rule.selectors.filter((selector) => FOCUS.test(selector)).map(subjectOf))
    .filter((subject) => subject.length > 0);
  const findings = [];
  for (const rule of allCssRules.filter((entry) => componentCss.includes(entry.file))) {
    for (const selector of rule.selectors.filter((entry) => entry.includes(':hover') && !FOCUS.test(entry))) {
      if (POINTER_ONLY.some((pattern) => pattern.test(selector))) continue;
      const hovered = new Set(subjectOf(selector));
      if (focusSubjects.some((subject) => subject.every((part) => hovered.has(part)))) continue;
      findings.push(`${rule.file}:${rule.line} ${selector}`);
    }
  }
  return findings;
}

/** A rule that gives hover and keyboard focus one look and drops the outline leaves focus indistinguishable from hover. */
function focusSameAsHover() {
  const findings = [];
  for (const rule of allCssRules.filter((entry) => componentCss.includes(entry.file))) {
    const removesOutline = readDeclarations(rule.body).some(([property, value]) => property === 'outline' && /^(?:none|0)\b/.test(value));
    if (!removesOutline) continue;
    const hovered = new Set(rule.selectors.filter((selector) => selector.includes(':hover')).map((selector) => selector.replace(/:hover/g, '')));
    for (const selector of rule.selectors.filter((entry) => entry.includes(':focus-visible'))) {
      if (hovered.has(selector.replace(/:focus-visible/g, ''))) findings.push(`${rule.file}:${rule.line} ${selector}`);
    }
  }
  return findings;
}

/** The two preserved assets whose motion is the running state itself; everything else stops under reduced motion. */
const ALWAYS_MOVING = new Set(['active-signal-shimmer', 'composerEnergyOrbit']);
const REDUCED_MOTION = /prefers-reduced-motion:\s*reduce/;
const normalizeSelector = (selector) => selector.replace(/\s+/g, ' ').replace(/^:root /, '').trim();

/** Every infinite animation has a reduced-motion rule for the same selector (the global layer prefixes `:root`). */
function reducedMotion() {
  const stopped = new Set(allCssRules
    .filter((rule) => rule.atRules.some((prelude) => REDUCED_MOTION.test(prelude)))
    .flatMap((rule) => rule.selectors.map(normalizeSelector)));
  const findings = [];
  for (const rule of allCssRules.filter((entry) => !entry.atRules.some((prelude) => REDUCED_MOTION.test(prelude)))) {
    const infinite = readDeclarations(rule.body).find(([property, value]) => (
      (property === 'animation' || property === 'animation-iteration-count') && /\binfinite\b/.test(value)));
    if (!infinite) continue;
    const name = readDeclarations(rule.body).find(([property]) => property === 'animation' || property === 'animation-name')?.[1].split(/\s+/)
      .find((token) => ALWAYS_MOVING.has(token));
    if (name) continue;
    for (const selector of rule.selectors) {
      if (!stopped.has(normalizeSelector(selector))) findings.push(`${rule.file}:${rule.line} ${selector}`);
    }
  }
  return findings;
}

/** A programmatic scroll that glides asks lib/motion, which jumps instead under reduced motion. */
function smoothScrolls() {
  const findings = [];
  for (const file of files.filter((name) => /\.tsx?$/.test(name) && name !== 'src/renderer/lib/motion.ts')) {
    const text = read(file);
    for (const match of text.matchAll(/behavior\s*:\s*['"`]smooth['"`]/g)) findings.push(`${file}:${lineOf(text, match.index)} ${match[0]}`);
  }
  return findings;
}

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'checkbox',
  'radio', 'switch', 'slider', 'spinbutton', 'textbox', 'combobox', 'searchbox', 'treeitem', 'gridcell']);
/** Shared controls that render a focusable element and pass data-tooltip to it. */
const INTERACTIVE_COMPONENTS = new Set(['Button', 'IconButton', 'Pill', 'CheckPill', 'Checkbox', 'Switch', 'Select', 'Input',
  'Textarea', 'SearchField', 'CopyButton', 'ListRow', 'Badge']);

/**
 * A tooltip is keyboard-reachable only from something focusable: the element itself (a control, tabIndex or an
 * interactive role) or a control around it, whose focus shows the tooltip of a label inside it (ui/TooltipHost).
 */
function tooltipTargets() {
  const findings = [];
  const attributes = (node) => (ts.isJsxElement(node) ? node.openingElement : node).attributes.properties.filter(ts.isJsxAttribute);
  const tagOf = (node) => (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText();
  const isInteractive = (node) => {
    const tag = tagOf(node);
    const attrs = attributes(node);
    const role = attrs.find((attr) => attr.name.getText() === 'role');
    const roleValue = role?.initializer && ts.isStringLiteral(role.initializer) ? role.initializer.text : null;
    return INTERACTIVE_TAGS.has(tag) || INTERACTIVE_COMPONENTS.has(tag) || attrs.some((attr) => attr.name.getText() === 'tabIndex')
      || (role !== undefined && (roleValue === null || INTERACTIVE_ROLES.has(roleValue)));
  };
  for (const file of files.filter((name) => name.endsWith('.tsx') && name !== 'src/renderer/ui/OverflowFade.tsx')) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      // aria-hidden marks a pointer-only copy of information shown elsewhere (a usage bar beside its legend); a named
      // image (role="img" with aria-label) is announced by its name, and the control around it shows the tooltip.
      const isElement = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
      const named = (name) => isElement && attributes(node).some((attr) => attr.name.getText() === name);
      const namedImage = named('aria-label') && attributes(node).some((attr) => attr.name.getText() === 'role'
        && attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'img');
      if (named('data-tooltip') && !isInteractive(node) && !named('aria-hidden') && !namedImage) {
        let ancestor = node.parent;
        let reachable = false;
        while (ancestor && !ts.isSourceFile(ancestor) && !ts.isFunctionLike(ancestor)) {
          if ((ts.isJsxElement(ancestor) || ts.isJsxSelfClosingElement(ancestor)) && isInteractive(ancestor)) {
            reachable = true;
            break;
          }
          ancestor = ancestor.parent;
        }
        if (!reachable) findings.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} <${tagOf(node)} data-tooltip>`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
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
    ['Hover locate on Working tool, web, subagent and thinking rows, never a glow', ['WorkProcessRowParts.tsx', 'WorkProcessWebParts.tsx', 'SubagentRow.tsx', 'WorkProcessThinking.tsx']
      .every((name) => files.some((file) => file.endsWith(`/${name}`) && read(file).includes('data-locate')))
      && !files.some((file) => /proximity/iu.test(read(file)))],
    ['Thinking duration label', [...parseLocale('zh-CN').values()].some((value) => value.startsWith('已思考 · '))],
  ];
  return checks.filter(([, present]) => !present).map(([name]) => name);
}

function parseLocale(locale) {
  const directory = path.join(rendererRoot, 'i18n/locales', locale);
  const entries = new Map();
  for (const name of fs.readdirSync(directory)) {
    const text = fs.readFileSync(path.join(directory, name), 'utf8');
    for (const match of text.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"):\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/gm)) {
      entries.set(match[1] ?? match[2], match[3] ?? match[4] ?? match[5]);
    }
  }
  return entries;
}

const results = {
  'invalid-transition': invalidTransitions(),
  'inline-svg': inlineSvg(),
  'text-glyph': textGlyphs(),
  'raw-error-render': rawErrorRender(),
  'literal-color': literalColors(),
  'bare-alert': bareAlerts(),
  'hover-focus-pair': hoverFocusPairs(),
  'focus-same-as-hover': focusSameAsHover(),
  'reduced-motion': reducedMotion(),
  'smooth-scroll': smoothScrolls(),
  'tooltip-target': tooltipTargets(),
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
