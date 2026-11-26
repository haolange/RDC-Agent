// A small CSS reader for the renderer gates: rules with their selector list, declarations, enclosing at-rules and line.
// It understands nesting through braces only, which is all renderer CSS uses (no CSS nesting syntax).

/** Comments blanked to spaces so offsets and line numbers stay true. */
export const stripCssComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

/** Splits on commas outside parentheses: `a:is(:hover, :focus), b` yields two selectors. */
export function splitTopLevel(value, separator = ',') {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Every style rule in `text`: `{ selectors, body, atRules, line }`. `atRules` lists the enclosing at-rule preludes
 * (`@media (prefers-reduced-motion: reduce)`), outermost first. Keyframe steps are skipped.
 */
export function readCssRules(text) {
  const source = stripCssComments(text);
  const rules = [];
  const stack = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      const raw = source.slice(start, index);
      const line = source.slice(0, start + raw.length - raw.trimStart().length).split('\n').length;
      stack.push({ prelude: raw.trim(), line, bodyStart: index + 1 });
      start = index + 1;
    } else if (character === '}') {
      const open = stack.pop();
      if (!open) continue;
      const inKeyframes = stack.some((entry) => /^@(?:-webkit-)?keyframes\b/.test(entry.prelude));
      if (!open.prelude.startsWith('@') && !inKeyframes) {
        rules.push({
          selectors: splitTopLevel(open.prelude),
          body: source.slice(open.bodyStart, index),
          atRules: stack.filter((entry) => entry.prelude.startsWith('@')).map((entry) => entry.prelude),
          line: open.line,
        });
      }
      start = index + 1;
    } else if (character === ';' && stack.length === 0) {
      start = index + 1;
    }
  }
  return rules;
}

/** Declarations of one rule body as `[property, value, offset]`, custom properties included. */
export function readDeclarations(body) {
  const declarations = [];
  let offset = 0;
  for (const part of splitTopLevel(body, ';')) {
    const at = body.indexOf(part, offset);
    offset = at + part.length;
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    declarations.push([part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim(), at]);
  }
  return declarations;
}
