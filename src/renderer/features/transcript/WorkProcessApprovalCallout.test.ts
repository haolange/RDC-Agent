import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ToolApprovalCallout } from './WorkProcessToolCardParts';
import { translate } from '../../i18n';

vi.mock('../../i18n', async importOriginal => {
  const original = await importOriginal<typeof import('../../i18n')>();
  return { ...original, useI18n: () => ({ language: 'en', t: (key: Parameters<typeof original.translate>[1]) => original.translate('en', key) }) };
});

it('translates operation risk, review source and non-execution labels independently of the host reason', () => {
  const html = renderToStaticMarkup(createElement(ToolApprovalCallout, { approval: {
    status: 'rejected', verb: '审核未完成', message: 'Host timeout detail.',
    metaLines: ['风险：high', '独立审核', '操作未执行'],
  } }));
  for (const key of ['chat.workProcessReviewIncomplete', 'chat.workProcessRiskHigh', 'chat.workProcessModelReview', 'chat.workProcessNotExecuted'] as const) {
    expect(html).toContain(translate('en', key));
  }
  expect(html).toContain('Host timeout detail.');
  expect(html).not.toContain('风险：high');
});
