import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { AgentSkillPicker } from './AgentSkillPicker';

type Props = ComponentProps<typeof AgentSkillPicker>;
const t: Props['t'] = (key) => key;
const props: Props = {
  t, targetAgentId: 'analyzer', value: ['missing', 'restricted'], onChange: vi.fn(),
  skills: { enabled: true, loading: false, error: '', refresh: vi.fn(), catalog: {
    status: 'ready', options: [
      { id: 'visible', name: 'Visible skill', description: 'not a list description', scope: 'user', sourcePath: '/skill', sourceHash: 'hash', effectiveStatus: 'effective', allowedTools: [], unavailableToAgentIds: [] },
      { id: 'restricted', name: 'Restricted skill', description: '', scope: 'builtin', sourcePath: '/skill', sourceHash: 'hash', effectiveStatus: 'effective', allowedTools: [], unavailableToAgentIds: ['analyzer'] },
    ],
  } },
};

describe('AgentSkillPicker', () => {
  it('uses catalog labels and localized sources and retains selected missing/target-restricted IDs', () => {
    const html = renderToStaticMarkup(createElement(AgentSkillPicker, props));
    expect(html).toContain('Visible skill');
    expect(html).toContain('settings.scopeUser');
    expect(html).toContain('settings.skillSelectionMissing');
    expect(html).toContain('settings.skillSelectionTargetUnavailable');
    expect(html.indexOf('missing')).toBeLessThan(html.indexOf('restricted'));
    expect(html).not.toContain('not a list description');
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it('changes target visibility without rewriting selected references', () => {
    const html = renderToStaticMarkup(createElement(AgentSkillPicker, { ...props, targetAgentId: 'general' }));
    expect(html).toContain('Restricted skill');
    expect(html).not.toContain('settings.skillSelectionTargetUnavailable');
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it('renders failed reads with retry rather than empty or missing status', () => {
    const html = renderToStaticMarkup(createElement(AgentSkillPicker, { ...props,
      skills: { ...props.skills, catalog: null, error: 'read denied' },
    }));
    expect(html).toContain('read denied');
    expect(html).toContain('settings.skillSelectionRetry');
    expect(html).not.toContain('settings.skillSelectionEmpty');
    expect(html).not.toContain('settings.skillSelectionMissing');
  });
});
