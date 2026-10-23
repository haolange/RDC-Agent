import { WEB_MAX_RESPONSE_BYTES, WEB_MAX_SOURCE_BYTES } from './toolLimits';

export interface WebTextCursor { offset?: number; expectedSourceHash?: string }

export function validateWebTextCursor(params: WebTextCursor) {
  const offset = params.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > WEB_MAX_SOURCE_BYTES) {
    throw new Error('Web text offset must be a nonnegative integer within the source bound.');
  }
  if ((offset > 0 && !params.expectedSourceHash)
    || (params.expectedSourceHash !== undefined && !/^[a-f0-9]{64}$/i.test(params.expectedSourceHash))) {
    throw new Error('A valid complete source hash is required for continuation.');
  }
  return { offset, expectedSourceHash: params.expectedSourceHash?.toLowerCase() };
}

export function readWebTextPage(text: string, sourceHash: string, cursor: ReturnType<typeof validateWebTextCursor>) {
  if (cursor.expectedSourceHash !== undefined && cursor.expectedSourceHash !== sourceHash) {
    throw new Error('Web source hash mismatch; pages cannot be joined across changed responses.');
  }
  const { offset } = cursor;
  if (offset > text.length || (offset > 0 && /[\uDC00-\uDFFF]/.test(text[offset] ?? '')
    && /[\uD800-\uDBFF]/.test(text[offset - 1]))) {
    throw new Error('Web text offset is past the source or splits a Unicode surrogate pair.');
  }
  const remaining = Buffer.from(text.slice(offset), 'utf8');
  let bytes = Math.min(remaining.length, WEB_MAX_RESPONSE_BYTES);
  let pageText = '';
  for (;;) {
    try {
      pageText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(remaining.subarray(0, bytes));
      break;
    } catch {
      // The complete source is valid UTF-8; only a page-end code point can be incomplete.
      bytes -= 1;
    }
  }
  const nextOffset = offset + pageText.length;
  const truncated = nextOffset < text.length;
  return {
    text: pageText, truncated,
    page: { offset, bytes, ...(truncated ? { nextOffset } : {}) },
  };
}
