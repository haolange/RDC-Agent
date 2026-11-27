import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { translate } from '../../i18n/messages';
import { PlanAuthorizationList } from './PlanAuthorizationList';
import type { PlanAuthorization } from '@shared/types/planInvestigation';

const locale = vi.hoisted(() => ({ language: 'en' as 'en' | 'zh-CN' }));
vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      translate(locale.language, key, params),
  }),
}));

const replacement: PlanAuthorization = {
  operation: 'rd.shader.edit_and_replace',
  target: { eventId: 1248, stage: 'ps', shaderId: 'ResourceId::5521' },
  effect: 'shader_replacement',
  reversibility: 'rollback-before-next',
  maxInstances: 2,
};

it.each([
  ['zh-CN', '替换着色器 · 事件 1248 · 像素着色器 · 指定的着色器', '最多 2 次、每次修改先撤回再做下一次'],
  [
    'en',
    'Replace a shader · event 1248 · pixel shader · the specific shader',
    'up to 2 times, each change is reverted before the next',
  ],
] as const)('reads each approved change in %s without catalog names or identifiers', (language, title, detail) => {
  locale.language = language;
  const html = renderToStaticMarkup(createElement(PlanAuthorizationList, { authorizations: [replacement] }));
  expect(html).toContain(title);
  expect(html).toContain(detail);
  expect(html).not.toMatch(/rd\.shader|ResourceId|shader_replacement|rollback-before-next/);
});

it('renders nothing when the plan authorizes no change', () => {
  expect(renderToStaticMarkup(createElement(PlanAuthorizationList, { authorizations: [] }))).toBe('');
});
