import { expect, it } from 'vitest';
import { extractPreview, structuredText } from './knowledgeFs';

it('previews prose, never raw structured chapters or the repeated title', () => {
  const body = [
    '# Hair darkening', '## Claim', 'Hair darkening',
    '## Scope + Exclusions', '{"platform":"Android","api":"Vulkan"}',
    '## Symptoms', '{"visual":"Hair appears darker than the reference."}',
    '## Fix', 'Adjust the energy term.',
  ].join('\n\n');
  expect(extractPreview(body)).toBe('Adjust the energy term.');
  expect(structuredText({ visual: 'Hair appears darker.', steps: ['Replay', 'Compare'] })).toBe('Hair appears darker. · Replay · Compare');
});
