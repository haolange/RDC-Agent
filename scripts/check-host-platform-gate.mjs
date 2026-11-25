/**
 * Self-test for the host platform gate in eslint.config.mjs: each host check
 * must fail outside src/main/platform and pass inside it, and shell command
 * content that merely mentions PowerShell must stay allowed.
 */
import { ESLint } from 'eslint';

// The probes are virtual files that no tsconfig contains; the host gate is syntactic, so lint them without type info.
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: false } },
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
});
const GATE_RULE = 'no-restricted-syntax';

const violations = {
  'process.platform': "export const isWindows = process.platform === 'win32';\n",
  'process.arch': 'export const arch = process.arch;\n',
  'os.platform()': "import os from 'node:os';\nexport const name = os.platform();\n",
  'os platform import': "import { platform } from 'node:os';\nexport const name = platform();\n",
  'APPDATA read': 'export const root = process.env.APPDATA;\n',
  'SystemRoot computed read': "export const root = process.env['SystemRoot'];\n",
  'USERPROFILE destructuring': 'const { USERPROFILE } = process.env;\nexport const home = USERPROFILE;\n',
  'taskkill literal': "import { spawnSync } from 'node:child_process';\nspawnSync('taskkill', ['/PID', '1', '/T', '/F']);\n",
  'powershell.exe literal': "import path from 'node:path';\nexport const shell = path.join('C:/Windows', 'powershell.exe');\n",
  'Get-CimInstance template': 'export const script = (pid: number) => `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`;\n',
};
const allowedCommandContent = "export const denied = '& \"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -enc AAAA';\n";

async function gateMessages(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === GATE_RULE || message.fatal);
}

const failures = [];
for (const [name, code] of Object.entries(violations)) {
  for (const filePath of ['src/main/runtime/host-gate-probe.ts', 'src/shared/utils/host-gate-probe.test.ts']) {
    if ((await gateMessages(code, filePath)).length === 0) failures.push(`${name} was not rejected in ${filePath}`);
  }
  if ((await gateMessages(code, 'src/main/platform/host-gate-probe.ts')).length) failures.push(`${name} was rejected inside src/main/platform`);
}
if ((await gateMessages(allowedCommandContent, 'src/main/agent-runtime/tools/primitives/host-gate-probe.ts')).length) {
  failures.push('shell command content mentioning powershell.exe was rejected');
}
if ((await gateMessages(violations['process.platform'], 'src/preload/index.ts')).length) {
  failures.push('the preload platform exposure point was rejected');
}

if (failures.length) throw new Error(`host platform gate self-test failed:\n- ${failures.join('\n- ')}`);
console.log(`check:host-platform passed (${Object.keys(violations).length} host checks rejected outside src/main/platform)`);
