import { expect, it } from 'vitest';
import { windowOffsets } from './useWindowedList';

it('positions rows using measured heights and the estimate for the rest', () => {
  expect(windowOffsets(['a', 'b', 'c'], new Map([['b', 640]]), 160)).toEqual([0, 160, 800, 960]);
});
