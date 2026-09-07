import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
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

const languages: Array<[string, Parameters<typeof hljs.registerLanguage>[1]]> = [
  ['bash', bash],
  ['sh', bash],
  ['shell', bash],
  ['c', c],
  ['cpp', cpp],
  ['c++', cpp],
  ['csharp', csharp],
  ['cs', csharp],
  ['css', css],
  ['go', go],
  ['java', java],
  ['javascript', javascript],
  ['js', javascript],
  ['json', json],
  ['kotlin', kotlin],
  ['kt', kotlin],
  ['markdown', markdown],
  ['md', markdown],
  ['php', php],
  ['python', python],
  ['py', python],
  ['ruby', ruby],
  ['rb', ruby],
  ['rust', rust],
  ['rs', rust],
  ['sql', sql],
  ['swift', swift],
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
