import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearComposerDraftModel,
  readComposerDraftModel,
  useComposerModelDraftStore,
  writeComposerDraftModel,
} from './composerModelDraft';

describe('composerModelDraft', () => {
  beforeEach(() => {
    useComposerModelDraftStore.getState().reset();
  });

  it('keeps no-session drafts per project and does not invent a session', () => {
    writeComposerDraftModel('project-a', { providerId: 'openai', modelId: 'gpt-5.6-sol' });
    writeComposerDraftModel('project-b', { providerId: 'kimi-coding-plan', modelId: 'k3' });
    expect(readComposerDraftModel('project-a')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
    });
    expect(readComposerDraftModel('project-b')?.modelId).toBe('k3');
    clearComposerDraftModel('project-a');
    expect(readComposerDraftModel('project-a')).toBeNull();
    expect(readComposerDraftModel('project-b')?.providerId).toBe('kimi-coding-plan');
  });
});
