import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');
const { englishTranslations, chineseTranslations } = require('../src/renderer/i18n/messages.ts');
const { nativeEnglish, nativeChinese } = require('../src/main/window/nativeMessages.ts');
const { commandEnglish, commandChinese } = require('../src/main/commands/commandMessages.ts');
const { BUILTIN_AGENT_TOOL_IDS } = require('../src/shared/constants/agentToolTokens.ts');
const { ERROR_CODES, errorParamsSchema } = require('../src/shared/errors/errorCodes.ts');
const { WORK_PROCESS_TOOL_DISPLAY_CATALOG } = require('../src/renderer/features/transcript/workProcessToolCatalog.ts');
const root = path.resolve(import.meta.dirname, '..');
const errors = [];
const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');

/** Proper nouns stay English in every locale: Agent and mode names, product names, RenderDoc and protocol terms. */
const PROPER_NOUNS = new Set([
  'Ask',
  'Plan',
  'Edit',
  'Debugger',
  'Analyzer',
  'Optimizer',
  'General',
  'Verifier',
  'Agent',
  'Max',
  'Fast',
  'English',
  'RDC',
  'RDC-Tool',
  'RDC-Agent',
  'RenderDoc',
  'Git',
  'MCP',
  'API',
  'LLM',
  'GPU',
  'Capture',
  'Swapchain',
  'Present',
  'Texture',
  'RT',
  'SKILL.md',
  '.gitignore',
]);

function compare(en, zh, label) {
  for (const key of new Set([...Object.keys(en), ...Object.keys(zh)])) {
    if (!Object.hasOwn(en, key) || !Object.hasOwn(zh, key)) errors.push(`${label}: missing key ${key}`);
    else if ((!en[key].trim() || !zh[key].trim()) && !key.startsWith('contextBreakdown.countSuffix.'))
      errors.push(`${label}: empty copy ${key}`);
    else if (placeholders(en[key]) !== placeholders(zh[key])) errors.push(`${label}: placeholder mismatch ${key}`);
  }
}
compare(englishTranslations, chineseTranslations, 'renderer');

// Every registered error code has its own copy in both languages, every `errors.<CODE>` key is a registered code, and
// a placeholder in that copy names a required param of the code's schema, so interpolation never shows `{name}`.
const registeredCodes = new Set(ERROR_CODES);
for (const key of Object.keys(englishTranslations).filter((name) => name.startsWith('errors.'))) {
  if (!registeredCodes.has(key.slice('errors.'.length))) errors.push(`error copy for an unregistered code: ${key}`);
}
for (const code of ERROR_CODES) {
  const key = `errors.${code}`;
  if (!Object.hasOwn(englishTranslations, key) || !Object.hasOwn(chineseTranslations, key)) {
    errors.push(`error code without copy: ${code}`);
    continue;
  }
  const shape = errorParamsSchema(code).shape;
  for (const placeholder of placeholders(englishTranslations[key]).split(',').filter(Boolean)) {
    const name = placeholder.slice(1, -1);
    if (!Object.hasOwn(shape, name) || shape[name].safeParse(undefined).success)
      errors.push(`error copy ${key} interpolates {${name}}, which is not a required param of ${code}`);
  }
}
compare(nativeEnglish, nativeChinese, 'native');
compare(commandEnglish, commandChinese, 'command');

for (const language of ['en', 'zh-CN']) {
  const keys = new Set();
  const folder = path.join(root, 'src/renderer/i18n/locales', language);
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.ts'))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(path.join(folder, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) {
        const key = node.name.text;
        if (keys.has(key)) errors.push(`${language}: duplicate key ${key}`);
        keys.add(key);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

for (const [key, text] of Object.entries(englishTranslations)) {
  if (key !== 'language.zh' && /\p{Script=Han}/u.test(text))
    errors.push(`English contains Chinese product copy: ${key}`);
}

// A key whose Chinese and English text match is untranslated unless every word in it is a proper noun. The loaded
// catalogs are the source, so a key counts whichever quotes its locale file uses.
for (const [key, value] of Object.entries(chineseTranslations)) {
  if (englishTranslations[key] !== value) continue;
  const words = value
    .replace(/\{[^}]+\}/g, ' ')
    .split(/[\s·/→,:%()+-]+/)
    .filter((word) => /[A-Za-z]/.test(word));
  if (PROPER_NOUNS.has(value.trim()) || words.length === 0 || words.every((word) => PROPER_NOUNS.has(word))) continue;
  errors.push(`untranslated: ${key} = ${JSON.stringify(value)} in both languages`);
}

// Copy lives in the catalogs. A renderer script (.ts or .tsx) may not carry a Chinese string, JSX text or an English
// sentence. Technical text is exempt where it can only reach「复制详情」: an Error / AppError message, a thrown value,
// a console line, a comparison with an external message, and the diagnostic fields message / detail / error / reason.
const SENTENCE = /^[A-Z][a-z]*(?:['’][a-z]+)?(?:[\s,]+[\w'’()-]+){2,}[.!?…]$/u;
const HAN = /\p{Script=Han}/u;
const DIAGNOSTIC_FIELDS = new Set(['message', 'detail', 'error', 'reason']);
const MATCHING_CALLS = new Set(['includes', 'startsWith', 'endsWith', 'test', 'match', 'indexOf']);
/** Bilingual search aliases match either language whatever the UI shows; they are data, not copy. */
const SEARCH_ALIAS_FIELDS = new Set(['keywords']);
/** Attributes that read out as copy; a literal with letters in one of them is hard-coded (placeholders hold samples). */
const COPY_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'alt',
  'title',
  'data-tooltip',
  'label',
  'ariaLabel',
]);
/** Literal JSX text that is not copy: product names and samples that preview a font or a code face. */
const JSX_TEXT_ALLOWED = new Set(['RDC-Agent', 'float4 color;', 'Aa']);
const isTechnicalContext = (node) => {
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); node = parent, parent = parent.parent) {
    if (ts.isThrowStatement(parent)) return true;
    if (ts.isNewExpression(parent) && /Error$/.test(parent.expression.getText())) return true;
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression.getText();
      if (/^console\./.test(callee) || /Error$/.test(callee)) return true;
      if (ts.isPropertyAccessExpression(parent.expression) && MATCHING_CALLS.has(parent.expression.name.text))
        return true;
      return false;
    }
    if (ts.isBinaryExpression(parent) && /^(?:===|!==|==|!=)$/.test(parent.operatorToken.getText())) return true;
    if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
      const name = parent.name.getText().replace(/['"]/g, '');
      return DIAGNOSTIC_FIELDS.has(name) || SEARCH_ALIAS_FIELDS.has(name);
    }
    if (ts.isJsxAttribute(parent) || ts.isVariableDeclaration(parent) || ts.isReturnStatement(parent)) return false;
  }
  return false;
};
/**
 * Hard-coded copy in files another change owns at the moment, counted per file; a count may only fall. The receipt
 * heading is model-facing text copied from main's ToolResultArtifactizer: both sides should read one shared constant.
 */
const PENDING_OWNER_FIXES = {};
const pendingCopy = new Map();
const rendererSources = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : rendererSources(full);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|d)\.tsx?$/.test(entry.name) ? [full] : [];
  });
for (const file of rendererSources(path.join(root, 'src/renderer'))) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    let text = null;
    let jsx = false;
    if (ts.isJsxText(node)) {
      text = node.text.trim();
      jsx = true;
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text.trim();
    if (text && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const attributeCopy = ts.isJsxAttribute(node.parent) && COPY_ATTRIBUTES.has(node.parent.name.getText());
      const copy =
        HAN.test(text) ||
        (jsx || attributeCopy ? /[A-Za-z]/.test(text) && !JSX_TEXT_ALLOWED.has(text) : SENTENCE.test(text));
      if (copy && !isTechnicalContext(node)) {
        if (Object.hasOwn(PENDING_OWNER_FIXES, rel)) pendingCopy.set(rel, (pendingCopy.get(rel) ?? 0) + 1);
        else errors.push(`hard-coded copy ${rel}:${line} ${JSON.stringify(text.slice(0, 80))}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const expected = new Set(BUILTIN_AGENT_TOOL_IDS);
for (const id of new Set([...expected, ...Object.keys(WORK_PROCESS_TOOL_DISPLAY_CATALOG)])) {
  if (!expected.has(id) || !Object.hasOwn(WORK_PROCESS_TOOL_DISPLAY_CATALOG, id))
    errors.push(`Tool catalog mismatch: ${id}`);
  const display = WORK_PROCESS_TOOL_DISPLAY_CATALOG[id];
  if (!display) continue;
  for (const field of ['category', 'groupTitle', 'groupUnit', 'completeVerb', 'runningVerb', 'pendingVerb']) {
    const key = display[field];
    if (key && (!Object.hasOwn(englishTranslations, key) || !Object.hasOwn(chineseTranslations, key)))
      errors.push(`${id}.${field}: missing translation ${key}`);
  }
}
for (const name of ['workProcessUseLabel.ts', 'workProcessCatalogVerbLabels.ts']) {
  if (fs.existsSync(path.join(root, 'src/renderer/features/transcript', name)))
    errors.push(`Retired reverse translation path exists: ${name}`);
}
for (const [file, allowed] of Object.entries(PENDING_OWNER_FIXES)) {
  const count = pendingCopy.get(file) ?? 0;
  if (count > allowed)
    errors.push(`hard-coded copy ${file}: ${count} pending hit(s), more than the ${allowed} recorded`);
  else if (count < allowed)
    console.log(`[i18n] pending ${file}: ${count} hit(s); lower its PENDING_OWNER_FIXES entry to ${count}`);
}
if (errors.length) {
  const message = errors.map((error) => `[i18n] ${error}`).join('\n');
  console.error(message);
  throw new Error(message);
}
console.log(
  `[i18n] ${Object.keys(englishTranslations).length} bilingual renderer keys, ${ERROR_CODES.length} error codes, ${Object.keys(nativeEnglish).length} native keys, ${expected.size} builtin tools verified.`,
);
