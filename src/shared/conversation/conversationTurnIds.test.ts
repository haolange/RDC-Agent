import { describe, expect, it } from 'vitest';
import { conversationTurnIds } from './conversationTurnIds';

describe('conversation turn ids', () => {
  it('derives the same ids from the same request id, in main and the renderer alike', () => {
    expect(conversationTurnIds('5f0c6c1e-7d3a-4b8f-9a21-2c4d6e8f0a1b')).toEqual(conversationTurnIds('5f0c6c1e-7d3a-4b8f-9a21-2c4d6e8f0a1b'));
  });

  it('gives every message, the turn and the branch of a request distinct ids, and other requests other ids', () => {
    const ids = conversationTurnIds('request-1');
    expect(new Set(Object.values(ids)).size).toBe(Object.keys(ids).length);
    expect(Object.values(conversationTurnIds('request-2')).some((id) => Object.values(ids).includes(id))).toBe(false);
  });

  it('keeps ids inside the IPC id grammar for a renderer request id', () => {
    for (const id of Object.values(conversationTurnIds(globalThis.crypto.randomUUID()))) {
      expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/);
      expect(id.length).toBeLessThanOrEqual(128);
    }
  });
});
