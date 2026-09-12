import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LlmProviderEntry } from '@shared/types/settings';
import { createProviderConnectionDraft } from '../providerConnectionState';
import { ProviderConnectionFields } from './ProviderConnectionFields';

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as React.ReactNode)];
  });
}

describe('stored provider credential interaction', () => {
  it.each([false, true])('preserves the stored reference on focus; explicit replacement edits it (schema=%s)', (withSchema) => {
    const provider = {
      id: 'test', label: 'Test', authMode: 'api-key', protocol: 'OpenAIChatCompletions',
      models: [], hasStoredSecret: true,
      ...(withSchema ? {
        hasStoredConnectionSecrets: { apiKey: true },
        connectionSchema: {
          primarySecretFieldId: 'apiKey',
          fields: [{ id: 'apiKey', label: 'API Key', kind: 'secret', required: true }],
        },
      } : {}),
    } as unknown as LlmProviderEntry;
    const draft = createProviderConnectionDraft(provider);
    const update = vi.fn();
    const render = () => elements(ProviderConnectionFields({
      connectionProvider: provider, connectionDraft: draft,
      onUpdateConnectionDraft: update, t: ((key: string) => key) as never,
    }));
    const input = render().find((element) => element.type === 'input' && element.props.type === 'password')!;
    expect(input.props.readOnly).toBe(true);
    (input.props.onFocus as (() => void) | undefined)?.();
    expect(update).not.toHaveBeenCalled();
    const replace = render().find((element) => element.props['aria-label'] === 'settings.replaceSecret')!;
    (replace.props.onClick as () => void)();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ usingStoredSecret: false, apiKey: '' }));
    draft.busy = 'testing';
    expect(render().find((element) => element.props['aria-label'] === 'settings.replaceSecret')!.props.disabled).toBe(true);
  });
});
