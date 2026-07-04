import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const languages: Array<[string, Parameters<typeof hljs.registerLanguage>[1]]> = [
  ['bash', bash],
  ['sh', bash],
  ['shell', bash],
  ['css', css],
  ['go', go],
  ['java', java],
  ['javascript', javascript],
  ['js', javascript],
  ['json', json],
  ['markdown', markdown],
  ['md', markdown],
  ['python', python],
  ['py', python],
  ['rust', rust],
  ['rs', rust],
  ['sql', sql],
  ['typescript', typescript],
  ['ts', typescript],
  ['tsx', typescript],
  ['html', xml],
  ['xml', xml],
  ['yaml', yaml],
  ['yml', yaml],
];

for (const [name, language] of languages) {
  hljs.registerLanguage(name, language);
}

export { hljs };
