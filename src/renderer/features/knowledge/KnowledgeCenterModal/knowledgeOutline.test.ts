import { expect, it } from 'vitest';
import { bodyWithoutTitle, markdownOutline } from './knowledgeOutline';

it('drops a leading title that repeats the card title and outlines headings outside code', () => {
  const body = '# Shadow acne\n\nIntro\n\n## Symptoms\n\n```md\n# not a heading\n```\n\n### Depth bias ##\n';
  expect(bodyWithoutTitle(body, 'Shadow acne').startsWith('Intro')).toBe(true);
  expect(bodyWithoutTitle(body, 'Other')).toBe(body);
  expect(markdownOutline(bodyWithoutTitle(body, 'Shadow acne'))).toEqual([
    { title: 'Symptoms', level: 2 },
    { title: 'Depth bias', level: 3 },
  ]);
});
