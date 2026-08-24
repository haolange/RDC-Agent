import { describe, expect, it } from 'vitest';
import type { ComposerModelPickerOption } from './composerModelPicker';
import {
  isComposerAgentDefaultToken,
  resolveComposerAgentDefaultState,
} from './composerAgentDefaultModel';

const option: ComposerModelPickerOption = {
  providerId: 'openai',
  providerLabel: 'OpenAI',
  modelId: 'gpt-5.6-sol',
  label: 'GPT-5.6 Sol',
  aliases: [],
  contextWindowTokens: 128000,
  contextWindowLabel: '128k',
  hasReasoning: false,
};

describe('isComposerAgentDefaultToken', () => {
  it('matches only the bare default keyword', () => {
    expect(isComposerAgentDefaultToken('default')).toBe(true);
    expect(isComposerAgentDefaultToken(' Default ')).toBe(true);
    expect(isComposerAgentDefaultToken('openai:default')).toBe(false);
    expect(isComposerAgentDefaultToken('agent-default')).toBe(false);
    expect(isComposerAgentDefaultToken('')).toBe(false);
  });
});

describe('resolveComposerAgentDefaultState', () => {
  it('returns unset when the Agent route is empty', () => {
    expect(resolveComposerAgentDefaultState(null, [option], true)).toEqual({
      kind: 'unset',
      selectable: false,
    });
    expect(resolveComposerAgentDefaultState({ providerId: '', modelId: 'x' }, [option], true)).toEqual({
      kind: 'unset',
      selectable: false,
    });
    expect(resolveComposerAgentDefaultState({ providerId: 'openai', modelId: '' }, [option], false)).toEqual({
      kind: 'unset',
      selectable: false,
    });
  });

  it('returns available when the Agent route matches a picker option', () => {
    expect(resolveComposerAgentDefaultState(
      { providerId: 'openai', modelId: 'gpt-5.6-sol' },
      [option],
      false,
    )).toEqual({
      kind: 'available',
      selectable: true,
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
      providerLabel: 'OpenAI',
      modelLabel: 'GPT-5.6 Sol',
    });
  });

  it('returns pending only while the catalog is not ready and the route is unmatched', () => {
    expect(resolveComposerAgentDefaultState(
      { providerId: 'openai', modelId: 'gpt-5.6-luna' },
      [option],
      false,
    )).toEqual({
      kind: 'pending',
      selectable: true,
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
    });
  });

  it('returns unavailable only after the catalog is ready and the route is unmatched', () => {
    expect(resolveComposerAgentDefaultState(
      { providerId: 'openai', modelId: 'gpt-5.6-luna' },
      [option],
      true,
    )).toEqual({
      kind: 'unavailable',
      selectable: false,
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
    });
  });
});
