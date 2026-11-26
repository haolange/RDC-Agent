import { describe, expect, it } from 'vitest';
import { isActiveThinkingStatus, isActiveWorkProcessStatus } from './workProcessActiveSignal';

describe('workProcessActiveSignal', () => {
  it('activates only live Work Process statuses', () => {
    expect(isActiveWorkProcessStatus('running')).toBe(true);
    expect(isActiveWorkProcessStatus('pending')).toBe(true);
    expect(isActiveWorkProcessStatus('complete')).toBe(false);
    expect(isActiveWorkProcessStatus('error')).toBe(false);
  });

  it('activates streaming thinking without making completed thinking live', () => {
    expect(isActiveThinkingStatus('streaming', 'complete')).toBe(true);
    expect(isActiveThinkingStatus('complete', 'complete')).toBe(false);
    expect(isActiveThinkingStatus('complete', 'running')).toBe(false);
    expect(isActiveThinkingStatus(undefined, 'running')).toBe(true);
  });
});
