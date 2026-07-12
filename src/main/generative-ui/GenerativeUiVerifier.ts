import type {
  GenerativeUiSource,
  GenerativeUiSpec,
  GenerativeUiVerificationResult,
} from '@shared/types/generativeUi';

const forbiddenPatterns = [
  { id: 'no-network-fetch', pattern: /\bfetch\s*\(/i, message: 'Network fetch is unavailable in the Canvas sandbox.' },
  { id: 'no-network-sockets', pattern: /\b(?:WebSocket|EventSource|XMLHttpRequest)\b/i, message: 'Network sockets are unavailable in the Canvas sandbox.' },
  { id: 'no-dynamic-import', pattern: /\bimport\s*\(/i, message: 'Dynamic imports are unavailable in the Canvas sandbox.' },
  { id: 'no-remote-url', pattern: /(?:https?:)?\/\//i, message: 'Remote URLs are unavailable in the Canvas sandbox.' },
  { id: 'no-top-navigation', pattern: /\b(?:window\.)?(?:top|parent)\s*\./i, message: 'Parent-frame access is forbidden.' },
  { id: 'no-storage', pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/i, message: 'Persistent browser storage is unavailable; use Canvas state.' },
];

const check = (id: string, passed: boolean, message: string) => ({ id, passed, message });
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const referencesId = (source: string, id: string) => {
  const escaped = escapeRegExp(id);
  return new RegExp(`(?:id\\s*=\\s*["']${escaped}["']|#${escaped}\\b|getElementById\\(\\s*["']${escaped}["']|querySelector\\(\\s*["']#${escaped}["'])`, 'i').test(source);
};
const referencesBindingSource = (source: string, name: string) =>
  referencesId(source, name) || new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(source);

const validateHtml = (html: string) => {
  if (/<\/?(?:script|style)\b/i.test(html)) return false;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const stack: string[] = [];
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of markup.matchAll(/<\s*(\/?)\s*([a-z][\w-]*)\b[^>]*?(\/?)>/gi)) {
    const tag = match[2].toLowerCase();
    if (voidTags.has(tag) || match[3]) continue;
    if (match[1]) {
      if (stack.pop() !== tag) return false;
    } else stack.push(tag);
  }
  return stack.length === 0 && !/<[^>]*$/.test(markup);
};

const validateCss = (css: string) => {
  if (/@import\b/i.test(css)) return false;
  const stack: string[] = [];
  const pairs: Record<string, string> = { '}': '{', ')': '(', ']': '[' };
  let quote = '';
  const input = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote && input[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if ('{(['.includes(char)) stack.push(char);
    else if ('})]'.includes(char) && stack.pop() !== pairs[char]) return false;
  }
  return !quote && stack.length === 0;
};

const interactionHandled = (spec: GenerativeUiSpec, source: GenerativeUiSource, trigger: string, effect: string) => {
  const description = `${trigger} ${effect}`.toLowerCase();
  const targets = spec.components.filter(({ id }) => description.includes(id.toLowerCase()));
  if (targets.length > 0 && !targets.every(({ id }) => referencesId(`${source.html}\n${source.javascript}`, id))) return false;
  const eventName = ['submit', 'input', 'change', 'click'].find((event) => trigger.toLowerCase().includes(event)) ?? 'click';
  const aliases = eventName === 'input' ? 'input|change' : eventName === 'change' ? 'change|input' : eventName;
  return new RegExp(`(?:addEventListener\\(\\s*["'](?:${aliases})["']|on(?:${aliases})\\s*=)`, 'i')
    .test(`${source.html}\n${source.javascript}`);
};

const controlsAreLabelled = (html: string) => {
  for (const match of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attributes = match[2];
    if (/\btype\s*=\s*["']?hidden\b/i.test(attributes)) continue;
    if (/\baria-label(?:ledby)?\s*=\s*["'][^"']+["']/i.test(attributes)) continue;
    const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    if (id && new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${escapeRegExp(id)}["']`, 'i').test(html)) continue;
    return false;
  }
  return true;
};

export class GenerativeUiVerifier {
  verifyLevel1(source: GenerativeUiSource): GenerativeUiVerificationResult {
    const combined = `${source.html}\n${source.css}\n${source.javascript}`;
    const checks = [
      check('html-present', source.html.trim().length > 0, 'Generated HTML must not be empty.'),
      check('source-size', combined.length <= 1_000_000, 'Generated source must stay below 1 MB.'),
      check('html-structure', validateHtml(source.html), 'HTML must be balanced and keep script/style in their dedicated source fields.'),
      check('css-syntax', validateCss(source.css), 'CSS delimiters must be balanced and @import is forbidden.'),
      ...forbiddenPatterns.map((entry) => check(entry.id, !entry.pattern.test(combined), entry.message)),
    ];
    try {
      new Function(source.javascript);
      checks.push(check('javascript-syntax', true, 'JavaScript syntax is valid.'));
    } catch (error) {
      checks.push(check('javascript-syntax', false, error instanceof Error ? error.message : String(error)));
    }
    return { level: 1, passed: checks.every((entry) => entry.passed), checks, observedAt: Date.now() };
  }

  verifyLevel2(spec: GenerativeUiSpec, source: GenerativeUiSource): GenerativeUiVerificationResult {
    const combined = `${source.html}\n${source.css}\n${source.javascript}`;
    const checks = [
      check('spec-components', spec.components.every(({ id }) => referencesId(combined, id)), 'Every declared component must expose its exact stable id.'),
      check('responsive-layout', /@media|clamp\(|minmax\(|flex|grid/i.test(source.css), 'Use an explicit responsive layout strategy.'),
      check('viewport-safe', !/width\s*:\s*[1-9]\d{3,}px/i.test(source.css), 'Avoid fixed desktop-only widths.'),
      check('interaction-code', spec.interactions.every(({ trigger, effect }) => interactionHandled(spec, source, trigger, effect)), 'Every declared interaction requires an executable handler and any named component target.'),
      check('data-bindings', spec.dataBindings.every(({ source: from, target }) => referencesBindingSource(combined, from) && referencesId(combined, target)), 'Every data binding source and target must exist.'),
      check('semantic-root', /<(?:main|article|section|form)\b/i.test(source.html), 'Generated UI requires a semantic root landmark.'),
      check('image-alt', !/<img\b(?![^>]*\balt\s*=)[^>]*>/i.test(source.html), 'Images require alt text, including an empty alt for decorative images.'),
      check('control-labels', controlsAreLabelled(source.html), 'Form controls require a label or accessible name.'),
    ];
    return { level: 2, passed: checks.every((entry) => entry.passed), checks, observedAt: Date.now() };
  }
}
