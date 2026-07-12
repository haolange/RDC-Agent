import type { GenerativeUiRuntimeEventDetails, GenerativeUiRuntimeEventType, GenerativeUiVersion } from '@shared/types/generativeUi';

const matchingInteractionIndex = (trigger: string, checks: Array<{ id: string; passed: boolean; message: string }>, used: Set<number>): number => {
  const value = trigger.toLowerCase();
  const expectedType = value.includes('submit') ? 'submit' : value.match(/input|adjust|edit|type|slider/) ? 'input'
    : value.match(/change|select|filter/) ? 'change' : value.match(/click|open|toggle|switch|expand|run|pause|reset|restart|add|move|copy|zoom/) ? 'click' : null;
  const expectedTarget = ['button', 'form', 'input', 'slider', 'select'].find((target) => value.includes(target));
  return checks.findIndex((check, index) => !used.has(index) && check.passed && check.id.startsWith('interaction-')
    && (!expectedType || check.id === `interaction-${expectedType}`)
    && (!expectedTarget || check.message.toLowerCase().includes(expectedTarget === 'slider' ? 'input' : expectedTarget)));
};
const requiredInteractionsPassed = (version: GenerativeUiVersion, checks: Array<{ id: string; passed: boolean; message: string }>): boolean => {
  const used = new Set<number>();
  return version.spec.interactions.every((entry) => {
    const index = matchingInteractionIndex(entry.trigger, checks, used);
    if (index < 0) return false;
    used.add(index);
    return true;
  });
};

export function updateGenerativeUiRuntimeVerification(version: GenerativeUiVersion, eventType: GenerativeUiRuntimeEventType, details?: GenerativeUiRuntimeEventDetails): void {
  if (!['ready', 'interaction', 'runtime_error', 'unhandled_rejection'].includes(eventType)) return;
  const passed = eventType === 'ready' || eventType === 'interaction';
  const check = {
    id: eventType === 'ready' ? 'sandbox-ready' : eventType === 'interaction' ? `interaction-${details?.interactionType ?? 'unknown'}` : eventType,
    passed,
    message: details?.message ?? (eventType === 'ready' ? 'Sandbox renderer reported ready.' : eventType === 'interaction' ? 'Sandbox interaction was observed.' : 'Sandbox renderer reported a runtime failure.'),
  };
  const existing = version.verification.find((entry) => entry.level === 3);
  if (!existing) {
    version.verification.push({ level: 3, passed: passed && eventType === 'ready' && version.spec.interactions.length === 0, checks: [check], observedAt: Date.now() });
    return;
  }
  existing.checks.push(check);
  const hasFailure = existing.checks.some((entry) => !entry.passed);
  const hasReady = existing.checks.some((entry) => entry.id === 'sandbox-ready' && entry.passed);
  const interactionsPassed = requiredInteractionsPassed(version, existing.checks);
  existing.passed = !hasFailure && hasReady && interactionsPassed;
  existing.observedAt = Date.now();
}
