#!/usr/bin/env node
import { fail, isTestMode, pass, payloadOf, readHookContext } from './hook-check-lib.mjs';

const context = await readHookContext();
if (context.__parseError) fail('mission-plan-handoff-check: hook stdin is not valid JSON');

const payload = payloadOf(context);
const fromAgentId = String(payload.fromAgentId ?? payload.fromProfile ?? context.agentId ?? '').trim();
const toAgentId = String(payload.toAgentId ?? payload.toProfile ?? '').trim();
const prompt = String(payload.prompt ?? '').trim();
const event = String(context.event ?? '');
const depth = Number(payload.depth);
const checkpointId = String(payload.checkpointId ?? '').trim();

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

// Production payload: { fromAgentId, toAgentId, label, prompt, depth, isBigLoop, checkpointId? }.
// isBigLoop is computed by the caller from from/to/depth; this hook also recomputes so
// omitting the flag cannot skip a Mission replan gate (Debugger / Analyzer / Optimizer).
const MISSION_PLANNING = new Set(['debugger', 'analyzer', 'optimizer']);
const isBigLoop = payload.isBigLoop === true
  || (fromAgentId === 'general' && MISSION_PLANNING.has(toAgentId) && Number.isFinite(depth) && depth >= 2);
if (isBigLoop && !checkpointId) {
  fail('mission-plan-handoff-check: Big Loop requires a resolvable checkpointId');
}

pass('mission-plan-handoff-check: ok');
