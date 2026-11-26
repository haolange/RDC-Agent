import { describe, expect, it } from 'vitest';
import { AppError, RendererIpcError } from '@shared/errors/appError';
import { errorDetails, humanizeError } from './humanizeError';
import { englishTranslations, translate, type TranslationKey } from './messages';

const t = (key: TranslationKey, params?: Record<string, string | number>) => translate('en', key, params);

describe('humanizeError', () => {
  it('words a coded failure with its own copy and params, an uncoded one with the context copy', () => {
    expect(humanizeError(new AppError('CONVERSATION_BUSY', 'turn t-1 is running'), t, 'app.stopRunFailed')).toBe(
      englishTranslations['errors.CONVERSATION_BUSY'],
    );
    expect(
      humanizeError(new AppError('KNOWLEDGE_DRAFT_MIGRATION_CONFLICT', 'card-a,card-b', { params: { cards: 2 } }), t),
    ).toBe("Drafts weren't moved because 2 of them conflict with existing cards.");
    expect(humanizeError(new TypeError('cannot read properties of undefined'), t, 'app.stopRunFailed')).toBe(
      englishTranslations['app.stopRunFailed'],
    );
    expect(humanizeError(new TypeError('cannot read properties of undefined'), t)).toBe(
      englishTranslations['errors.INTERNAL_ERROR'],
    );
  });

  it('keeps technical facts for the clipboard only', () => {
    const error = new RendererIpcError('session:list', {
      code: 'STORAGE_CORRUPT',
      params: {},
      category: 'integrity',
      technical: 'STORAGE_CORRUPT: sessions.json quarantined',
    });
    expect(humanizeError(error, t)).not.toContain('sessions.json');
    expect(errorDetails(error)).toEqual([
      { label: 'Code', value: 'STORAGE_CORRUPT' },
      { label: 'Channel', value: 'session:list' },
      { label: 'Detail', value: 'STORAGE_CORRUPT: sessions.json quarantined' },
    ]);
  });
});
