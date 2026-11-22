import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaseChapterContent } from './CaseChapterContent';
import type { KnowledgeCaseChapter } from '@shared/types/knowledge';

vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    language: 'en',
    t: (key: string) => ({
      'knowledgeCenter.case.sourceDetails': 'Source and parameters',
      'knowledgeCenter.field.expected': 'Expected',
      'knowledgeCenter.field.observed': 'Observed',
      'knowledgeCenter.field.category_primary': 'Category',
      'knowledgeCenter.field.location': 'Location',
      'knowledgeCenter.evidenceKind.image_compare': 'Image comparison',
      'knowledgeCenter.valueUnknown': 'Unknown',
      'knowledgeCenter.listSeparator': ', ',
    }[key] ?? key),
  }),
}));

const render = (chapter: KnowledgeCaseChapter | undefined, value: unknown) => renderToStaticMarkup(createElement(CaseChapterContent, {
  spaceId: 'user', chapter, content: typeof value === 'string' ? value : JSON.stringify(value),
}));

describe('case chapters as an authored document', () => {
  it('leaves prose and invalid JSON on the Markdown path', () => {
    expect(render('fix', 'Cast to **float** after unpacking.')).toContain('<strong>float</strong>');
    expect(render(undefined, '{invalid}')).toContain('{invalid}');
  });

  it('compares expected with observed and reads the visual facts in words', () => {
    const markup = render('symptoms', {
      expected: 'Hair keeps its dark detail', observed: 'Hair washes out to white',
      visual: { phenomenon: ['wrong colour', 'too bright'], spatial_pattern: 'view_space', affected_objects: ['Mesh_Body', 'Props/Crate'] },
    });
    expect(markup).toContain('knowledge-symptom-comparison');
    expect(markup).toContain('Hair washes out to white');
    expect(markup).toContain('view space');
    expect(markup).not.toContain('view_space');
    expect(markup).toContain('<code>Mesh_Body</code>');
    expect(markup).toContain('wrong colour, too bright');
  });

  it('lists evidence as findings, keeps ids off the page and puts sources one click away', () => {
    const markup = render('evidence', [{
      evidence_id: 'e_spirv', type: 'image_compare',
      source: { tool: 'manual.spirv_edit', params: { file: 'asset-1f2e3d4c' } },
      summary: 'Removing the decoration on %17 restores the frame. <script>alert(1)</script>',
    }]);
    expect(markup).toContain('Image comparison');
    expect(markup).toContain('<code>%17</code>');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('e_spirv');
    expect(markup).not.toContain('asset-1f2e3d4c');
    expect(markup).not.toContain('<script>');
  });

  it('leads the root cause with its mechanism and names the category and location', () => {
    const markup = render('rootCause', {
      mechanism: 'A value on %21 goes negative and is clamped to zero.',
      category_primary: 'Numerical.Precision',
      invariant_broken: ['I-NORM-02'],
      blame: { component: 'shader_include', location: ':ShadeSurface' },
    });
    expect(markup).toMatch(/knowledge-case-lead[^>]*>A value on <code>%21<\/code>/u);
    expect(markup).toContain('Numerical › Precision');
    expect(markup).toContain('<code>I-NORM-02</code>');
    expect(markup).toContain('shader include');
    expect(markup).toContain('<code>:ShadeSurface</code>');
  });

  it('numbers verification steps and localizes unknown scope values', () => {
    expect(render('experimentVerification', ['Replay with the patch.', 'Check the other GPU.'])).toMatch(/<ol class="knowledge-case-steps"><li><span class="knowledge-case-step-text">Replay with the patch\.<\/span><\/li>/u);
    // A step mixing prose and identifiers stays one line of text, not one grid cell per run.
    expect(render('experimentVerification', ['Control: removing the decoration on %21 also restores it.']))
      .toContain('<li><span class="knowledge-case-step-text">Control: removing the decoration on <code>%21</code> also restores it.</span></li>');
    const scope = render('scopeExclusions', { platform: 'Android', driver: 'unknown' });
    expect(scope).toContain('knowledgeCenter.scope.platform');
    expect(scope).toContain('Unknown');
  });
});
