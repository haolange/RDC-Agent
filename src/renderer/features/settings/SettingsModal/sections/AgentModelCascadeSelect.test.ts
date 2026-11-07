import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n/messages';
import {
  AgentModelCascadeSelect,
  agentModelOptionAccessibleLabel,
  isAgentModelSelectionInvalid,
} from './AgentModelCascadeSelect';
import type { AgentModelOption } from '@shared/types/agentManifest';

const primaryOption: AgentModelOption = {
  canonicalId: 'kimi-coding-plan/kimi-for-coding',
  providerId: 'kimi-coding-plan',
  providerLabel: 'Kimi Coding Plan',
  modelId: 'kimi-for-coding',
  modelLabel: 'Kimi for Coding',
  configured: true,
  status: 'ready',
};

describe('AgentModelCascadeSelect selection validation', () => {
  it('preserves a configured model identity when its provider is not configured', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const unavailable: AgentModelOption = { ...primaryOption, configured: false,
      status: 'provider-unavailable', providerIssue: 'unconfigured' };
    const render = (option: AgentModelOption) => root.render(createElement(AgentModelCascadeSelect, {
      value: option.canonicalId, options: [option], onChange: () => {},
      t: (key, params) => translate('zh-CN', key, params),
    }));
    try {
      await act(async () => render(unavailable));
      expect(host.textContent).toContain(unavailable.modelLabel);
      expect(host.textContent).toContain(unavailable.canonicalId);
      expect(host.textContent).not.toContain('所选模型已失效');
      expect(host.textContent).toContain('所选供应商当前不可用');
      expect(host.querySelector('[aria-invalid]')?.getAttribute('aria-invalid')).toBe('true');
      await act(async () => render({ ...unavailable, status: 'missing', providerIssue: undefined }));
      expect(host.textContent).toContain('所选模型已失效');
      expect(host.querySelector('[aria-invalid]')?.getAttribute('aria-invalid')).toBe('true');
      await act(async () => root.render(createElement(AgentModelCascadeSelect, {
        value: unavailable.canonicalId, options: [unavailable], onChange: () => {},
        inherit: { label: 'Inherit', description: 'Use the target model' },
        t: (key, params) => translate('zh-CN', key, params),
      })));
      expect(host.textContent).toContain(unavailable.modelLabel);
      expect(host.textContent).not.toContain('所选模型已失效');
      expect(host.textContent).toContain('所选供应商当前不可用');
      expect(host.querySelector('[aria-invalid]')?.getAttribute('aria-invalid')).toBe('true');
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
    }
  });

  it('accepts a projected primary option', () => {
    expect(isAgentModelSelectionInvalid(primaryOption.canonicalId, [primaryOption])).toBe(false);
  });

  it('fails closed when a persisted internal target is absent from projection', () => {
    expect(isAgentModelSelectionInvalid(
      'kimi-coding-plan/kimi-for-coding-highspeed',
      [primaryOption],
    )).toBe(true);
  });

  it('allows an empty route while the user is choosing a model', () => {
    expect(isAgentModelSelectionInvalid('', [primaryOption])).toBe(false);
  });

  it('keeps the canonical route in accessibility metadata instead of a second visual line', () => {
    expect(agentModelOptionAccessibleLabel(primaryOption, 'Unavailable')).toBe(
      'Kimi for Coding · kimi-coding-plan/kimi-for-coding',
    );
    expect(agentModelOptionAccessibleLabel({
      ...primaryOption,
      configured: false,
      disabledReason: 'Account entitlement denied',
    }, 'Unavailable')).toBe(
      'Kimi for Coding · kimi-coding-plan/kimi-for-coding · Account entitlement denied',
    );
  });
});
