import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');
const { englishTranslations, chineseTranslations } = require('../src/renderer/i18n/messages.ts');
const { nativeEnglish, nativeChinese } = require('../src/main/window/nativeMessages.ts');
const { BUILTIN_AGENT_TOOL_IDS } = require('../src/shared/constants/agentToolTokens.ts');
const { WORK_PROCESS_TOOL_DISPLAY_CATALOG } = require('../src/renderer/features/transcript/workProcessToolCatalog.ts');
const root = path.resolve(import.meta.dirname, '..');
const errors = [];
const placeholders = text => (text.match(/\{\w+\}/g) ?? []).sort().join(',');

function compare(en, zh, label) {
  for (const key of new Set([...Object.keys(en), ...Object.keys(zh)])) {
    if (!Object.hasOwn(en, key) || !Object.hasOwn(zh, key)) errors.push(`${label}: missing key ${key}`);
    else if ((!en[key].trim() || !zh[key].trim()) && !key.startsWith('contextBreakdown.countSuffix.')) errors.push(`${label}: empty copy ${key}`);
    else if (placeholders(en[key]) !== placeholders(zh[key])) errors.push(`${label}: placeholder mismatch ${key}`);
  }
}
compare(englishTranslations, chineseTranslations, 'renderer');
compare(nativeEnglish, nativeChinese, 'native');

for (const language of ['en', 'zh-CN']) {
  const keys = new Set();
  const folder = path.join(root, 'src/renderer/i18n/locales', language);
  for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.ts'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(folder, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
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
  if (key !== 'language.zh' && /\p{Script=Han}/u.test(text)) errors.push(`English contains Chinese product copy: ${key}`);
}
const expected = new Set(BUILTIN_AGENT_TOOL_IDS);
for (const id of new Set([...expected, ...Object.keys(WORK_PROCESS_TOOL_DISPLAY_CATALOG)])) {
  if (!expected.has(id) || !Object.hasOwn(WORK_PROCESS_TOOL_DISPLAY_CATALOG, id)) errors.push(`Tool catalog mismatch: ${id}`);
  const display = WORK_PROCESS_TOOL_DISPLAY_CATALOG[id];
  if (!display) continue;
  for (const field of ['category', 'groupTitle', 'groupUnit', 'completeVerb', 'runningVerb', 'pendingVerb']) {
    const key = display[field];
    if (key && (!Object.hasOwn(englishTranslations, key) || !Object.hasOwn(chineseTranslations, key))) errors.push(`${id}.${field}: missing translation ${key}`);
  }
}
for (const name of ['workProcessUseLabel.ts', 'workProcessCatalogVerbLabels.ts']) {
  if (fs.existsSync(path.join(root, 'src/renderer/features/transcript', name))) errors.push(`Retired reverse translation path exists: ${name}`);
}
if (errors.length) {
  console.error(errors.map(error => `[i18n] ${error}`).join('\n'));
  process.exitCode = 1;
} else console.log(`[i18n] ${Object.keys(englishTranslations).length} bilingual renderer keys, ${Object.keys(nativeEnglish).length} native keys, ${expected.size} builtin tools verified.`);
