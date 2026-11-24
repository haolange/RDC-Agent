import { describe, expect, it } from 'vitest';
import {
  hasReadableCaseChapter,
  humanizeKey,
  humanizeTerm,
  isTermLike,
  looksLikeIdentifier,
  parseChapterValue,
  splitIdentifiers,
  withoutInternalReferences,
} from './knowledgeCaseValues';

describe('case chapter values', () => {
  it('offers a chapter only when the reader has something to display', () => {
    expect(hasReadableCaseChapter(' {} ')).toBe(false);
    expect(hasReadableCaseChapter('{"refs":["asset-1f2e3d4c"]}')).toBe(false);
    expect(hasReadableCaseChapter('{"draws":0}')).toBe(true);
    expect(hasReadableCaseChapter('Plain Markdown')).toBe(true);
  });

  it('reads keys and enum-like values as words without knowing the case', () => {
    expect(humanizeKey('spatial_pattern')).toBe('Spatial pattern');
    expect(humanizeKey('featureConfiguration')).toBe('Feature configuration');
    expect(humanizeKey('key_spirv_ids')).toBe('Key spirv ids');
    expect(humanizeTerm('view_space')).toBe('view space');
    expect(humanizeTerm('Shader.Compiler.ConstantFolding')).toBe('Shader › Compiler › Constant Folding');
    expect(humanizeTerm('Mobile Forward / LightGrid')).toBe('Mobile Forward / LightGrid');
    expect(isTermLike('static')).toBe(false);
    expect(isTermLike('shader_include')).toBe(true);
  });

  it('keeps searchable identifiers as code inside sentences', () => {
    expect(splitIdentifiers('定位到 %17，违反 I-NORM-02。')).toEqual([
      { text: '定位到 ', code: false },
      { text: '%17', code: true },
      { text: '，违反 ', code: false },
      { text: 'I-NORM-02', code: true },
      { text: '。', code: false },
    ]);
    expect(splitIdentifiers('ids %20-%24')).toEqual([{ text: 'ids ', code: false }, { text: '%20-%24', code: true }]);
    expect(looksLikeIdentifier('Mesh_Body')).toBe(true);
    expect(looksLikeIdentifier(':EvaluateLight -> Light.Radiance')).toBe(true);
    expect(looksLikeIdentifier('颜色错误')).toBe(false);
    expect(looksLikeIdentifier('static')).toBe(false);
  });

  it('drops internal references and the containers they leave empty', () => {
    const evidence = parseChapterValue('{"tool":"manual.spirv_edit","params":{"file":"asset-1f2e3d4c"},"link":"session://tool-outputs/x"}');
    expect(withoutInternalReferences(evidence!)).toEqual({ tool: 'manual.spirv_edit' });
    expect(parseChapterValue('plain prose')).toBeUndefined();
    expect(parseChapterValue('{broken')).toBeUndefined();
  });
});
