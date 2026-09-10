#!/usr/bin/env node
import { fail, isTestMode, pass, payloadOf, readHookContext } from './hook-check-lib.mjs';

const context = await readHookContext();
if (context.__parseError) fail('mission-plan-handoff-check: hook stdin is not valid JSON');

const payload = payloadOf(context);
const toAgentId = String(payload.toAgentId ?? payload.toProfile ?? '').trim();
const prompt = String(payload.prompt ?? '').trim();
const event = String(context.event ?? '');

if (isTestMode() && !toAgentId && !prompt) {
  pass('mission-plan-handoff-check: test mode skip');
}

if (event && event !== 'agent.before-handoff') {
  pass('mission-plan-handoff-check: not a handoff event');
}

if (!toAgentId) fail('mission-plan-handoff-check: handoff requires toAgentId');
if (!prompt) fail('mission-plan-handoff-check: handoff requires a non-empty prompt');
if (/\bembedding(s)?\b/i.test(toAgentId)) {
  fail('mission-plan-handoff-check: Embedding models must not enter Agent/handoff picker');
}

// Execution-cycle accounting is owned by HandoffStateStore, never duplicated in hooks.

// Handoff artifacts and domain contents are validated by main before this hook.
// Identity and chain depth do not imply a workflow or a checkpoint.

pass('mission-plan-handoff-check: ok');
