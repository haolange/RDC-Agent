import { describe, expect, it } from 'vitest';
import { uniqueResourceId } from './uniqueResourceId';

describe('new resource identity', () => {
  it('never reuses an existing default or numbered copy', () => {
    expect(uniqueResourceId('new-skill', ['new-skill', 'new-skill-2'])).toBe('new-skill-3');
    expect(uniqueResourceId('general-copy', ['general-copy', 'general-copy-3'])).toBe('general-copy-2');
    expect(uniqueResourceId('new-hook', [])).toBe('new-hook');
  });
});
