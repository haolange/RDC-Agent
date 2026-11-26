import { expect, it } from 'vitest';
import { translate } from '../../i18n/messages';
import { capabilityStatusPresentation } from './capabilityPresentation';

it('words every unavailable reason through a translation, never the diagnostic message', () => {
  const message = 'The effective model is missing its catalog or route revision.';
  const details = (['missing-model', 'missing-revision', 'route-mismatch', 'provider-unavailable'] as const).map(
    (reason) => {
      const { labelKey, detailKey } = capabilityStatusPresentation({ status: 'unavailable', reason, message });
      expect(labelKey).toBe('composer.effort.capabilityUnavailable');
      return translate('zh-CN', detailKey!);
    },
  );
  expect(new Set(details).size).toBe(4);
  expect(details.join('\n')).not.toContain(message);
});
