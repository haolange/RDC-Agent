import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { createProviderConnectionDraft } from '../providerConnectionState';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import type { LlmProviderEntry } from '@shared/types/settings';
const locale = vi.hoisted(() => ({ language: 'en' as 'en' | 'zh-CN' | 'keys' }));
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      locale.language === 'keys' ? key : translate(locale.language, key, params),
  }),
}));

const service: LlmProviderEntry = {
  id: 'test',
  label: 'Test',
  authMode: 'api-key',
  protocol: 'OpenAICompatibleChatCompletions',
  category: 'official-direct',
  endpointClass: 'first-party',
  serviceOperator: 'Test',
  lifecycleStatus: 'stable',
  providerAvailability: { state: 'available' },
  catalogOwnership: 'app-managed',
  catalogProvenance: [],
  enabled: true,
  models: [],
  recommendedModels: [],
  apiKey: '',
  hasStoredSecret: false,
  status: 'unconfigured',
  isConfigured: false,
};

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as React.ReactNode)];
  });
}

describe('stored provider credential interaction', () => {
  it('shows only a fully composed public address and binds its localized field labels to the inputs', () => {
    const provider: LlmProviderEntry = {
      ...service,
      connectionSchema: {
        fields: [
          { id: 'apiKey', kind: 'secret', label: 'API Key', required: true },
          { id: 'DATABRICKS_HOST', kind: 'url', label: 'Databricks workspace host', required: true },
        ],
      },
    };
    const draft = createProviderConnectionDraft(provider);
    const form = (address: string, language: 'en' | 'zh-CN') => {
      locale.language = language;
      const view = document.createElement('div');
      view.innerHTML = renderToStaticMarkup(
        React.createElement(ProviderConnectionFields, {
          connectionProvider: provider,
          connectionDraft: { ...draft, baseUrl: address },
          onUpdateConnectionDraft: vi.fn(),
        }),
      );
      return view;
    };
    const preview = '[data-testid="settings-provider-connect-endpoint-preview"]';
    expect(form('https://service.example/v1', 'en').querySelector(preview)).toBeNull();
    const template = 'https://${DATABRICKS_HOST}/models';
    expect(form(template, 'en').querySelector(preview)).toBeNull();
    draft.connectionValues.DATABRICKS_HOST = 'https://team.example/';
    expect(form('${DATABRICKS_HOST}', 'en').querySelector(preview)).toBeNull();
    expect(form(template, 'en').querySelector(preview)?.textContent).toBe('https://team.example/models');
    const chinese = form(template, 'zh-CN');
    expect(chinese.querySelector('label[for="settings-provider-input-DATABRICKS_HOST"]')?.textContent).toContain(
      '工作区主机',
    );
    expect(chinese.querySelector('label[for="settings-provider-input-apiKey"]')?.textContent).toContain('API 密钥');
    expect(chinese.querySelector('label button')).toBeNull();
    expect(chinese.querySelector('#settings-provider-input-apiKey')).not.toBeNull();
  });

  it.each([false, true])(
    'preserves the stored reference on focus; explicit replacement edits it (schema=%s)',
    (withSchema) => {
      const provider: LlmProviderEntry = {
        ...service,
        hasStoredSecret: true,
        ...(withSchema
          ? {
              hasStoredConnectionSecrets: { apiKey: true },
              connectionSchema: {
                primarySecretFieldId: 'apiKey',
                fields: [{ id: 'apiKey', label: 'API Key', kind: 'secret', required: true }],
              },
            }
          : {}),
      };
      const draft = createProviderConnectionDraft(provider);
      const update = vi.fn();
      locale.language = 'keys';
      const render = () =>
        elements(
          ProviderConnectionFields({
            connectionProvider: provider,
            connectionDraft: draft,
            onUpdateConnectionDraft: update,
          }),
        );
      const input = render().find((element) => element.type === 'input' && element.props.type === 'password')!;
      expect(input.props.readOnly).toBe(true);
      (input.props.onFocus as (() => void) | undefined)?.();
      expect(update).not.toHaveBeenCalled();
      const replace = render().find((element) => element.props['aria-label'] === 'settings.replaceSecret')!;
      (replace.props.onClick as () => void)();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ usingStoredSecret: false, apiKey: '' }));
      draft.busy = 'testing';
      expect(render().find((element) => element.props['aria-label'] === 'settings.replaceSecret')!.props.disabled).toBe(
        true,
      );
    },
  );
});
