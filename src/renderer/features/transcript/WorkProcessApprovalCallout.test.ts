import { createToolRowForPresentation } from './workProcessToolRows';
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
  const row = createToolRowForPresentation({ id: 'approval', toolName: 'shell', status: 'error', startedAt: 1,
    approval: { approvalId: 'approval', status: 'rejected', risk: 'high', reviewMethod: 'model', reviewer: 'auto_review',
      errorCode: 'REVIEW_TIMEOUT', reason: 'Host timeout detail.' },
  }, (key, params) => translate('en', key, params));
  if (row.type !== 'tool' || !row.approval) throw new Error('expected approval row');
  const html = renderToStaticMarkup(createElement(ToolApprovalCallout, { approval: row.approval }));
  for (const key of ['chat.workProcessReviewIncomplete', 'chat.workProcessRiskHigh', 'chat.workProcessModelReview', 'chat.workProcessNotExecuted'] as const) {
    expect(html).toContain(translate('en', key));
  }
  expect(html).toContain('Host timeout detail.');
  expect(html).not.toContain('风险：high');
});
