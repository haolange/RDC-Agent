import { describe, expect, it } from 'vitest';
import { AppError, errorCodeOf, RendererIpcError, toIpcErrorPayload } from './appError';
import { errorCategory, isErrorCode } from './errorCodes';

const redact = (text: string) => text.replace(/secret-\w+/g, '[REDACTED]');

describe('error contract', () => {
  it('keeps the CODE: detail message form and reads the code back from any carrier', () => {
    const error = new AppError('PLAN_REVIEW_BUSY', 'another review is open', { cause: new Error('lock held') });
    expect(error.message).toBe('PLAN_REVIEW_BUSY: another review is open');
    expect(error.category).toBe('availability');
    expect((error.cause as Error).message).toBe('lock held');
    expect(errorCodeOf(error)).toBe('PLAN_REVIEW_BUSY');
    expect(errorCodeOf(new Error('STORAGE_CORRUPT: config.json'))).toBe('STORAGE_CORRUPT');
    expect(errorCodeOf('AUDIT_WRITE_FAILED')).toBe('AUDIT_WRITE_FAILED');
    expect(errorCodeOf(new Error('NOT_A_REGISTERED_CODE: x'))).toBeUndefined();
  });

  it('maps failures to the IPC payload, redacting the technical text and defaulting to INTERNAL_ERROR', () => {
    expect(toIpcErrorPayload(new AppError('FILE_WRITE_PROTECTED', 'secret-abc is protected', { params: { path: 'config.json' } }), redact))
      .toEqual({ code: 'FILE_WRITE_PROTECTED', params: { path: 'config.json' }, category: 'security', technical: 'FILE_WRITE_PROTECTED: [REDACTED] is protected' });
    expect(toIpcErrorPayload(new TypeError('x is undefined'), redact)).toMatchObject({ code: 'INTERNAL_ERROR', category: 'integrity' });
  });

  it('rebuilds the payload on the renderer side as RendererIpcError', () => {
    const error = new RendererIpcError('session:list', { code: 'CONVERSATION_BUSY', params: {}, category: 'availability' });
    expect(errorCodeOf(error)).toBe('CONVERSATION_BUSY');
    expect(error.message).toBe('CONVERSATION_BUSY');
  });

  it('places every registered code in exactly one failure class', () => {
    expect(isErrorCode('INTERNAL_ERROR')).toBe(true);
    expect(errorCategory('AUDIT_WRITE_FAILED')).toBe('security');
    expect(errorCategory('STORAGE_CORRUPT')).toBe('integrity');
    expect(errorCategory('SHUTTING_DOWN')).toBe('availability');
  });
});
