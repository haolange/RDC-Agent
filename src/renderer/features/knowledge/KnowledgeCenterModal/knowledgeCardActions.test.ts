import { expect, it } from 'vitest';
import { knowledgeCardActions } from './knowledgeCardActions';

it('offers one primary action per lifecycle and keeps no-op actions out of the menu', () => {
  expect(knowledgeCardActions('draft', false)).toEqual({ primary: 'create-candidate', more: [] });
  expect(knowledgeCardActions('candidate', true)).toEqual({
    primary: 'persist-draft',
    more: ['promote-verified', 'promote-promoted', 'retire'],
  });
  expect(knowledgeCardActions('candidate', false)).toEqual({
    primary: 'promote-verified',
    more: ['promote-promoted', 'save', 'retire'],
  });
  expect(knowledgeCardActions('verified', false)).toEqual({ primary: 'promote-promoted', more: ['save', 'retire'] });
  expect(knowledgeCardActions('promoted', false)).toEqual({ primary: 'save', more: ['retire'] });
  expect(knowledgeCardActions('retired', false)).toEqual({
    primary: 'save',
    more: ['promote-verified', 'promote-promoted'],
  });
});
