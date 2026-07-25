import { describe, expect, it } from 'vitest';
import {
  generateCaptureId,
  generateCaseId,
  generateContextId,
  generateEventId,
  generateId,
  generateLockId,
  generateRunId,
  generateSessionId,
  generateShortId,
  generateTokenId,
  isAlphanumeric,
  nowIso,
  nowMs,
} from './id';

describe('id utils', () => {
  it('generates stable-shaped identifiers', () => {
    expect(generateId()).toMatch(/-/);
    expect(generateShortId()).toHaveLength(12);
    expect(generateEventId('agent-event')).toMatch(/^agent-event-/);
    expect(generateCaseId()).toMatch(/^case_/);
    expect(generateRunId()).toMatch(/^run_[0-9a-f]{16}$/);
    expect(generateSessionId('case_1', 'run_1')).toMatch(/^sess_/);
    expect(generateTokenId('ask')).toMatch(/^tok-/);
    expect(generateLockId('ask')).toMatch(/^lock-/);
    expect(generateContextId()).toMatch(/^ctx-/);
    expect(generateCaptureId('primary', 2)).toBe('cap-primary-002');
  });

  it('exposes time helpers and alphanumeric checks', () => {
    expect(typeof nowMs()).toBe('number');
    expect(nowIso()).toMatch(/T/);
    expect(isAlphanumeric('a')).toBe(true);
    expect(isAlphanumeric('_')).toBe(false);
  });
});
