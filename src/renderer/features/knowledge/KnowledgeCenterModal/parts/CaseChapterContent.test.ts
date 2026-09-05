import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaseChapterContent, parseChapterValue } from './CaseChapterContent';

describe('Case chapter reading', () => {
  it('leaves ordinary Markdown and invalid JSON on the Markdown path', () => {
    for (const content of ['## Claim\nText', '[evidence](file.md)', '{invalid}', '42']) {
      expect(parseChapterValue(content)).toBeUndefined();
    }
  });
  it('preserves nested unknown fields, empty containers, and falsy values', () => {
    const value = { unknown: [false, 0, null, '', [], {}], source: { file: '中文.md' } };
    expect(parseChapterValue(JSON.stringify(value))).toEqual(value);
    const markup = renderToStaticMarkup(createElement(CaseChapterContent, { content: JSON.stringify(value) }));
    for (const text of ['unknown', 'false', '>0<', 'null', '[]', '{}', '中文.md']) expect(markup).toContain(text);
  });
  it('renders evidence as readable fields and escapes embedded HTML', () => {
    const markup = renderToStaticMarkup(createElement(CaseChapterContent, { content: '[{"summary":"<script>alert(1)</script>","evidence_id":"e_1"}]' }));
    expect(markup).toContain('<dl');
    expect(markup).toContain('e_1');
    expect(markup).not.toContain('<script>');
  });
  it('keeps evidence summaries visible with a discoverable disclosure for source details', () => {
    const markup = renderToStaticMarkup(createElement(CaseChapterContent, {
      chapter: 'evidence', content: JSON.stringify([{ evidence_id: 'e_1', source: { tool: 'probe' }, summary: 'Visible finding' }]),
    }));
    expect(markup).toContain('Visible finding');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls=');
    expect(markup).not.toContain('<li');
  });
  it('retains empty and heterogeneous evidence and non-string symptom values', () => {
    const evidence = renderToStaticMarkup(createElement(CaseChapterContent, { chapter: 'evidence', content: '[{},null,0,false]' }));
    for (const text of ['{}', 'null', '>0<', 'false']) expect(evidence).toContain(text);
    const symptoms = renderToStaticMarkup(createElement(CaseChapterContent, { chapter: 'symptoms', content: '{"expected":false,"observed":0,"custom":"retained"}' }));
    for (const text of ['false', '>0<', 'retained']) expect(symptoms).toContain(text);
  });
});
