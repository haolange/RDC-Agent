import { expect, it } from 'vitest';
import { collapseUnchanged, diffLines } from './lineDiff';

it('aligns an inserted line instead of marking every following line changed', () => {
  expect(diffLines('a\nb\nc', 'a\nx\nb\nc')).toEqual([
    { kind: 'same', text: 'a' },
    { kind: 'add', text: 'x' },
    { kind: 'same', text: 'b' },
    { kind: 'same', text: 'c' },
  ]);
  expect(diffLines('', 'a')).toEqual([{ kind: 'add', text: 'a' }]);
});

it('keeps context around changes and folds long unchanged runs', () => {
  const before = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n');
  const after = before.replace('line 6', 'line six');
  const folded = collapseUnchanged(diffLines(before, after), 2);
  expect(folded[0]).toEqual({ kind: 'gap', count: 4 });
  expect(folded.filter((line) => line.kind !== 'gap').map((line) => line.text)).toEqual([
    'line 4',
    'line 5',
    'line 6',
    'line six',
    'line 7',
    'line 8',
  ]);
  expect(folded.at(-1)).toEqual({ kind: 'gap', count: 3 });
});
