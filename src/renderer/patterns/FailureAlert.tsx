import { useI18n, type TranslationKey } from '../i18n';
import { humanizeError } from '../i18n/humanizeError';
import { errorDetail } from '../lib/errorDetail';
import { InlineError } from '../ui/InlineError';

/**
 * A failure as one human sentence: the coded failure's own copy, else the caller's context copy. The technical text
 * leaves only through "Copy details".
 */
export function FailureAlert({
  reason,
  contextKey,
  className,
}: {
  reason?: unknown;
  contextKey: TranslationKey;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <InlineError className={className} detail={reason === undefined ? undefined : errorDetail(reason)}>
      {humanizeError(reason, t, contextKey)}
    </InlineError>
  );
}
