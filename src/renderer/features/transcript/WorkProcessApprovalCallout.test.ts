import { createToolRowForPresentation } from './workProcessToolRows';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ToolApprovalCallout } from './WorkProcessToolCardParts';
import { translate } from '../../i18n';
import type { ConversationToolCall } from '@shared/types/conversation';

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

it.each(['en', 'zh-CN'] as const)('distinguishes withdrawn approvals from stopped tools in %s without altering raw content', language => {
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(language, key, params);
  const call: ConversationToolCall = { id: 'continued-command', toolName: 'shell', status: 'complete', startedAt: 1,
    executionStartedAt: 2, completedAt: 3, resultPreview: '原始 output: PERMISSION_MODE_CHANGED',
    approval: { approvalId: 'old-request', status: 'cancelled', errorCode: 'PERMISSION_MODE_CHANGED',
      reason: 'PERMISSION_MODE_CHANGED', answer: 'PERMISSION_MODE_CHANGED' },
  };
  const original = JSON.stringify(call);
  const row = createToolRowForPresentation(call, t);
  if (row.type !== 'tool' || !row.approval) throw new Error('expected approval row');
  expect(row.status).toBe('complete');
  expect(row.verb).toBe(t('chat.workProcessVerb.shellComplete'));
  expect(row.approval.status).toBe('cancelled');
  expect(row.approval.verb).toBe(t('chat.workProcessApprovalModeChanged'));
  expect(row.approval.message).toBe(t('chat.workProcessApprovalModeChangedMessage'));
  expect(row.rawLines.join('\n')).toContain(call.resultPreview);
  expect(JSON.stringify(call)).toBe(original);
  const html = renderToStaticMarkup(createElement(ToolApprovalCallout, { approval: row.approval }));
  expect(html).toContain(t('chat.workProcessApprovalModeChanged'));

  const stopped = createToolRowForPresentation({ ...call, status: 'cancelled', approval: {
    ...call.approval!, errorCode: 'PERMISSION_REVIEW_CANCELLED',
  } }, t);
  if (stopped.type !== 'tool' || !stopped.approval) throw new Error('expected stopped tool');
  expect(stopped.status).toBe('cancelled');
  expect(stopped.approval.verb).toBe(t('chat.workProcessApprovalCancelled'));
  // A raw string alone cannot impersonate a typed host cancellation reason.
  expect(stopped.approval.message).toBe('PERMISSION_MODE_CHANGED');
});
