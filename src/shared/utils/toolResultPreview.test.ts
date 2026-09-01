import { describe, expect, it } from 'vitest';
import { buildToolResultPreview } from './toolResultPreview';

describe('buildToolResultPreview', () => {
  it('handles null and primitive results', () => {
    expect(buildToolResultPreview(null)).toBe('{}');
    const primitive = JSON.parse(buildToolResultPreview('hello'));
    expect(primitive.ok).toBe(true);
    expect(primitive.data.content[0].text).toBe('hello');
  });

  it('preserves denied reason envelopes', () => {
    const preview = JSON.parse(buildToolResultPreview({ reason: 'denied by policy' }));
    expect(preview.ok).toBe(false);
    expect(preview.error.message).toBe('denied by policy');
  });

  it('compacts content/details and keeps metadata', () => {
    const preview = JSON.parse(buildToolResultPreview({
      ok: true,
      duration_ms: 12,
      trace_id: 'tr-1',
      data: {
        content: [{ type: 'text', text: 'line1\nline2' }],
        details: {
          pattern: 'foo',
          results: [
            { title: 'A', url: 'https://a.test', snippet: 's'.repeat(300) },
            { title: 'B', url: 'https://b.test' },
          ],
        },
        matches: ['a', 'b'],
        lineCount: 2,
      },
    }));
    expect(preview.ok).toBe(true);
    expect(preview.duration_ms).toBe(12);
    expect(preview.trace_id).toBe('tr-1');
    expect(preview.data.details.matched).toBe(2);
    expect(preview.data.details.resultCount).toBe(2);
    expect(preview.data.details.results).toHaveLength(2);
  });

  it('preserves artifactized ref, hash, and summary', () => {
    const preview = JSON.parse(buildToolResultPreview({
      ok: true,
      data: {
        content: [{ type: 'text', text: 'stored' }],
        details: {
          artifactized: true,
          ref: 'session://tool-outputs/call-1.json',
          hash: 'abcdef0123456789',
          summary: 'Offloaded grep matches',
        },
      },
    }));
    expect(preview.data.details).toMatchObject({
      artifactized: true,
      ref: 'session://tool-outputs/call-1.json',
      hash: 'abcdef0123456789',
      summary: 'Offloaded grep matches',
    });
  });

  it('truncates very long preview JSON', () => {
    const huge = 'x'.repeat(20_000);
    const encoded = buildToolResultPreview({
      ok: true,
      data: { content: [{ type: 'text', text: huge }] },
    });
    expect(encoded.length).toBeLessThanOrEqual(12_000);
  });
});
