import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import glsl from 'highlight.js/lib/languages/glsl';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { hlsl } from './hlslLanguage';
import type { LanguageFn } from 'highlight.js';

/** The one language set: answers (rehype-highlight) and tool output (WorkProcessHighlightedCode) highlight the same way. */
export const MARKDOWN_LANGUAGES: Readonly<Record<string, LanguageFn>> = {
  bash, c, cpp, csharp, css, diff, glsl, go, hlsl, java, javascript, json, kotlin, markdown, php, python, ruby, rust,
  sql, swift, typescript, xml, yaml,
};

export const MARKDOWN_LANGUAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  bash: ['sh', 'shell', 'zsh'],
  cpp: ['c++', 'cc', 'cxx', 'hpp'],
  csharp: ['cs'],
  diff: ['patch'],
  glsl: ['vert', 'frag', 'comp', 'geom', 'tesc', 'tese'],
  hlsl: ['fx', 'fxh', 'hlsli'],
  javascript: ['js', 'jsx', 'mjs'],
  kotlin: ['kt'],
  markdown: ['md'],
  python: ['py'],
  ruby: ['rb'],
  rust: ['rs'],
  typescript: ['ts', 'tsx'],
  xml: ['html', 'svg'],
  yaml: ['yml'],
};

for (const [name, language] of Object.entries(MARKDOWN_LANGUAGES)) {
  hljs.registerLanguage(name, language);
  const aliases = MARKDOWN_LANGUAGE_ALIASES[name];
  if (aliases) hljs.registerAliases([...aliases], { languageName: name });
}

export { hljs };
