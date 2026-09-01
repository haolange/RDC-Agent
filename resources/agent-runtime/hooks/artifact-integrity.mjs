#!/usr/bin/env node
import { fail, isSha256Prefixed, pass, readHookContext, toolArgumentsOf } from './hook-check-lib.mjs';

const context = await readHookContext();
if (context.__parseError) fail('artifact-integrity: hook stdin is not valid JSON');

const args = toolArgumentsOf(context);
const status = String(args.status ?? '').trim();
const sourceRefs = Array.isArray(args.sourceRefs) ? args.sourceRefs : null;
const contentHash = typeof args.contentHash === 'string' ? args.contentHash.trim() : '';

if (status !== 'ready') pass('artifact-integrity: not a ready write');

if (!sourceRefs || sourceRefs.length < 1) {
  fail('artifact-integrity: ready requires sourceRefs.length >= 1');
}

for (const [index, ref] of sourceRefs.entries()) {
  const artifactId = typeof ref?.artifactId === 'string' ? ref.artifactId.trim() : '';
  const expectedHash = typeof ref?.expectedHash === 'string' ? ref.expectedHash.trim() : '';
  if (!artifactId) fail(`artifact-integrity: sourceRefs[${index}] missing artifactId`);
  if (!isSha256Prefixed(expectedHash)) {
    fail(`artifact-integrity: sourceRefs[${index}] expectedHash must be sha256:<64 hex>`);
  }
}

if (contentHash && !isSha256Prefixed(contentHash)) {
  fail('artifact-integrity: contentHash must be sha256:<64 hex>');
}

pass('artifact-integrity: ok');
