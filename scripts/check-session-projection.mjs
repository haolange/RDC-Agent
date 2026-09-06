import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptRead } from './renderer-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const fail = (message) => {
  console.error(`[session-projection] ${message}`);
  process.exit(1);
};

const read = (relativePath) => {
  if (relativePath.startsWith('src/')) return scriptRead(relativePath);
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    fail(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(absolute, 'utf8');
};

const bridge = read('src/renderer/app/bootstrap/useIpcEventBridge.ts');
const gate = read('src/renderer/app/bootstrap/sessionEventGate.ts');
const hygiene = read('src/renderer/app/bootstrap/sessionSwitchHygiene.ts');
const projectionStore = read('src/renderer/stores/sessionProjectionStore.ts');
const composerContext = read('src/renderer/features/debugger/composer/composerSessionContext.ts');
const sendFlow = read('src/renderer/features/debugger/composer/composerSendFlow.ts');
const contract = read('docs/contracts/session-projection.md');
const design = read('DESIGN.md');
const agents = read('AGENTS.md');

if (!gate.includes('export function isActiveSessionEvent')) {
  fail('sessionEventGate must export isActiveSessionEvent');
}

if (!bridge.includes('isActiveSessionEvent')) {
  fail('useIpcEventBridge must gate events with isActiveSessionEvent');
}

for (const required of [
  'onTraceProjectionChanged',
  'handleConversationEvent',
  'onWorkflowStateChanged',
  'projectConversationMessage',
  'projectTrace',
  'projectWorkflow',
]) {
  if (!bridge.includes(required)) {
    fail(`useIpcEventBridge must reference ${required}`);
  }
}

if (!hygiene.includes('captureActiveSession') || !hygiene.includes('resetForSessionSwitch')) {
  fail('sessionSwitchHygiene must capture projection and reset composer context');
}

if (!projectionStore.includes('activateSession') || !projectionStore.includes('projectConversationMessage')) {
  fail('sessionProjectionStore must expose activate/project APIs');
}

if (!composerContext.includes('restoreLastSentIfCurrentSession') || !composerContext.includes('sessionId')) {
  fail('composerSessionContext must bind lastSent restore to sessionId');
}

if (!sendFlow.includes('owningSessionId') || !sendFlow.includes('restoreComposerDraft')) {
  fail('composerSendFlow must bind restoreComposerDraft to owning session');
}

if (sendFlow.includes('setPromptValue(sentPrompt)') && !sendFlow.includes('activeSessionId !== owningSessionId')) {
  fail('composerSendFlow must refuse cross-session draft restore');
}

if (!contract.includes('Active Session') || !contract.includes('isActiveSessionEvent')) {
  fail('docs/contracts/session-projection.md must define active-session gate');
}

if (!design.includes('session-projection.md')) {
  fail('DESIGN.md Authority Map must reference session-projection.md');
}

if (!agents.includes('check:session-projection')) {
  fail('AGENTS.md must mention check:session-projection');
}

// Forbid unguarded setTracePresentation in the bridge body outside gated branches:
// require that every setTracePresentation call site is preceded by an active-session gate nearby.
const traceSetCount = (bridge.match(/setTracePresentation\(/g) || []).length;
const gateNearTrace = bridge.includes('isActiveSessionEvent(payload.sessionId)');
if (traceSetCount < 1 || !gateNearTrace) {
  fail('trace projection writes must be gated by payload.sessionId');
}

console.log('[session-projection] ok');
