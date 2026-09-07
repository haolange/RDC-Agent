import { describe, expect, it } from 'vitest';
import type { ComposerModelPickerOption } from './composerModelPicker';
import { resolveComposerModelOverride } from './resolveComposerModelOverride';

function option(
  partial: Pick<ComposerModelPickerOption, 'providerId' | 'modelId'> & Partial<ComposerModelPickerOption>,
): ComposerModelPickerOption {
  return {
    providerLabel: partial.providerId,
    label: partial.modelId,
    aliases: [],
    contextWindowTokens: null,
    contextWindowLabel: null,
    hasReasoning: false,
    ...partial,
  };
}

describe('resolveComposerModelOverride', () => {
  const options = [
    option({ providerId: 'openai', modelId: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }),
    option({ providerId: 'kimi-coding-plan', modelId: 'kimi-for-coding' }),
  ];

  it('accepts canonical provider:model ids from the picker catalog', () => {
    expect(resolveComposerModelOverride('openai:gpt-5.6-sol', options)).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
    });
    expect(resolveComposerModelOverride('chatgpt-account:gpt-5.6-sol', options)).toBeNull();
  });

  it('accepts a unique bare model id and rejects ambiguous or unknown ids', () => {
    expect(resolveComposerModelOverride('gpt-5.6-sol', options)).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
    });
    expect(resolveComposerModelOverride('openai:hidden', options)).toBeNull();
    expect(resolveComposerModelOverride('missing', options)).toBeNull();
    expect(resolveComposerModelOverride('', options)).toBeNull();
  });

  it('keeps provider:model as the escape hatch for a model named default', () => {
    const withDefault = [...options, option({ providerId: 'openai', modelId: 'default' })];
    expect(resolveComposerModelOverride('openai:default', withDefault)).toEqual({
      providerId: 'openai',
      modelId: 'default',
    });
    expect(resolveComposerModelOverride('default', withDefault)).toEqual({
      providerId: 'openai',
      modelId: 'default',
    });
  });
});
