#!/usr/bin/env node
import { fail, isTestMode, pass, payloadOf, readHookContext, toolArgumentsOf } from './hook-check-lib.mjs';

const HARDCODED = [
  /(?:^|[\\/"']|\s)renderdoccmd(?:\.exe)?(?=["'\s]|$)/i,
  /(?:^|[\\/"']|\s)qrenderdoc(?:\.exe)?(?=["'\s]|$)/i,
  /[a-z]:\\program files(?: \(x86\))?\\renderdoc\b/i,
  /\/usr\/(?:local\/)?bin\/(?:q)?renderdoccmd\b/i,
  /\brdc-mcp\b/i,
  /\bmcp__rdc\b/i,
];

const context = await readHookContext();
if (context.__parseError) {
  process.stderr.write('rdc-shell-audit: hook stdin is not valid JSON\n');
  process.exit(isTestMode() ? 0 : 1);
}

const toolName = String(context.toolName ?? payloadOf(context).toolName ?? '');
if (toolName && toolName !== 'shell') pass('rdc-shell-audit: not a shell call');

const args = toolArgumentsOf(context);
const command = [args.command, args.cmd, args.executable, args.program]
  .filter((value) => typeof value === 'string')
  .join(' ');
const haystack = [command, typeof args.script === 'string' ? args.script : '']
  .join('\n')
  .trim();

if (!haystack) pass('rdc-shell-audit: no command to audit');

for (const pattern of HARDCODED) {
  if (pattern.test(haystack)) {
    fail('rdc-shell-audit: hardcoded RenderDoc/RDC-Tool CLI or RDC MCP path is forbidden; use the Settings-configured RDC shell action');
  }
}

pass('rdc-shell-audit: ok');
