import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import presentation from '@shared/provider-catalog/manifests/presentation.json';
import { translate } from '../../../../i18n/messages';
import { PROVIDER_BRAND_ICONS } from '../../../../ui/icons/providerBrandIcons';
import { directoryGroups, providerBrand } from './providerDirectoryModel';
import { providerIdentityDetail } from './providerCardModel';
import type { LlmProviderEntry } from '@shared/types/settings';

const source = resolve('src/shared/provider-catalog/manifests/surfaces');
const entries = readdirSync(source).filter(file => file.endsWith('.json')).map(file => {
  const surface: Pick<LlmProviderEntry, 'id' | 'label' | 'category' | 'endpointClass'> &
    { models: { modelId: string; label: string }[] } = JSON.parse(readFileSync(resolve(source, file), 'utf8'));
  return { ...surface, models: surface.models.map(model => ({ id: model.modelId, label: model.label })) };
});
const en = translate.bind(null, 'en');
const zh = translate.bind(null, 'zh-CN');

describe('provider discovery', () => {
  it('retains every connection once across presentation groups and validates the catalog references', () => {
    const ids = entries.map(entry => entry.id);
    const all = directoryGroups(entries, 'all', '', en).flatMap(group => group.entries.map(entry => entry.id));
    expect(all.sort()).toEqual([...ids].sort());
    const tiers = [...presentation.recommended, ...presentation.featured, ...presentation.listed];
    expect(new Set(tiers).size).toBe(tiers.length);
    const members = presentation.families.flatMap(family => family.ids);
    expect(new Set(members).size).toBe(members.length);
    for (const id of [...tiers, ...members, ...Object.keys(presentation.brands), ...Object.keys(presentation.aliases)]) {
      expect(ids).toContain(id);
      const brand = providerBrand(id);
      if (brand) expect(PROVIDER_BRAND_ICONS).toHaveProperty(`brand-${brand}`);
    }
    const suggested = directoryGroups(entries, 'recommended', '', en).flatMap(group => group.entries.map(entry => entry.id));
    expect(suggested.sort()).toEqual([...presentation.recommended].sort());
  });

  it('finds long-tail services, model names and individual routes directly from the initial view', () => {
    const ids = (query: string) => directoryGroups(entries, 'recommended', query, zh)
      .flatMap(group => group.entries.map(entry => entry.id));
    expect(ids('Hermes')).toContain('nous');
    const accountIds = (query: string) => directoryGroups(entries, 'login-authorization', query, en)
      .flatMap(group => group.entries.map(entry => entry.id));
    expect(accountIds('')).not.toContain('nous');
    expect(accountIds('Hermes')).toContain('nous');
    expect(ids('kimi-k3.1-pro')).toContain('moonshot');
    expect(ids('硅基流动')).toEqual(expect.arrayContaining(['siliconflow', 'siliconflow-cn']));
    expect(ids('硅基流动 国内')).toEqual(['siliconflow-cn']);
    expect(ids('OpenAI 欧洲')).toEqual(['openai-eu']);
    const region = directoryGroups(entries, 'all', 'openai', en).find(group => group.key === 'OpenAI');
    expect(region?.entries.map(entry => entry.id).sort()).toEqual(['openai', 'openai-eu', 'openai-us']);
  });

  it('keeps other routes of a configured brand available and recommends only remaining exact entries', () => {
    const remaining = entries.filter(entry => entry.id !== 'openai' && entry.id !== 'anthropic');
    const [regions] = directoryGroups(remaining, 'all', 'openai', en).filter(group => group.key === 'OpenAI');
    expect(regions.entries.map(entry => entry.id).sort()).toEqual(['openai-eu', 'openai-us']);
    const suggested = directoryGroups(remaining, 'recommended', '', en).flatMap(group => group.entries.map(entry => entry.id));
    expect(suggested.sort()).toEqual(['github-copilot', 'google-ai-studio', 'openrouter']);
  });

  it('distinguishes login from a key and shows a distinct account identity only once', () => {
    expect(providerIdentityDetail({ authMode: 'account', category: 'login-authorization',
      accountLabel: 'ChatGPT Account', planLabel: 'Plus' }, 'ChatGPT Account', en)).toBe('Account login · Plus');
    expect(providerIdentityDetail({ authMode: 'api-key', category: 'official-direct' }, 'OpenAI', en)).toBe('API Key');
  });
});
