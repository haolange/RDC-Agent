import { describe, expect, it } from 'vitest';
import { AppError, RendererIpcError } from '@shared/errors/appError';
import { isErrorCode } from '@shared/errors/errorCodes';
import { errorDetails, humanizeError } from './humanizeError';
import { englishTranslations, translate, type TranslationKey } from './messages';

const t = (key: TranslationKey, params?: Record<string, string | number>) => translate('en', key, params);

describe('humanizeError', () => {
  it('only words registered codes', () => {
    const coded = Object.keys(englishTranslations).filter((key) => key.startsWith('errors.') && !key.startsWith('errors.category.'));
    expect(coded.filter((key) => !isErrorCode(key.slice('errors.'.length)))).toEqual([]);
  });

  it('prefers the code copy, then the context copy, then the failure class', () => {
    expect(humanizeError(new AppError('CONVERSATION_BUSY', 'turn t-1 is running'), t, 'app.stopRunFailed'))
      .toBe(englishTranslations['errors.CONVERSATION_BUSY']);
    expect(humanizeError(new AppError('RDC_SWITCH_CHILD_ACTIVE', 'child 42'), t, 'app.stopRunFailed')).toBe(englishTranslations['app.stopRunFailed']);
    expect(humanizeError(new AppError('RDC_SWITCH_CHILD_ACTIVE', 'child 42'), t)).toBe(englishTranslations['errors.category.integrity']);
    expect(humanizeError(new TypeError('cannot read properties of undefined'), t)).toBe(englishTranslations['errors.INTERNAL_ERROR']);
  });

  it('keeps technical facts for the clipboard only', () => {
    const error = new RendererIpcError('session:list', {
      code: 'STORAGE_CORRUPT', params: {}, category: 'integrity', technical: 'STORAGE_CORRUPT: sessions.json quarantined',
    });
    expect(humanizeError(error, t)).not.toContain('sessions.json');
    expect(errorDetails(error)).toEqual([
      { label: 'Code', value: 'STORAGE_CORRUPT' },
      { label: 'Channel', value: 'session:list' },
      { label: 'Detail', value: 'STORAGE_CORRUPT: sessions.json quarantined' },
    ]);
  });
});
