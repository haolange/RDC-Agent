import { describe, expect, it } from 'vitest';
import { knowledgeErrorMessage } from './knowledgeCenterModel';

describe('knowledgeErrorMessage', () => {
  it('keeps the real service message instead of collapsing to a bare code', () => {
    const error = Object.assign(new Error('KNOWLEDGE_WRITE_PATH_REJECTED: path escaped the space root'), {
      code: 'KNOWLEDGE_WRITE_PATH_REJECTED',
    });
    expect(knowledgeErrorMessage(error)).toBe('KNOWLEDGE_WRITE_PATH_REJECTED: path escaped the space root');
  });

  it('falls back to code only when no message exists', () => {
    expect(knowledgeErrorMessage({ code: 'KNOWLEDGE_SPACE_UNKNOWN' })).toBe('KNOWLEDGE_SPACE_UNKNOWN');
  });
});
