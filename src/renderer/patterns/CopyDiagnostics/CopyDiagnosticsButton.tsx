import { useI18n } from '../../i18n';
import { CopyButton } from '../../ui/CopyButton';
import { useCopyDiagnostics, type DiagnosticFact } from './useCopyDiagnostics';

/** A quiet copy glyph that hands an object's technical facts to the clipboard; nothing technical is shown. */
export function CopyDiagnosticsButton({
  facts,
  className,
  testId,
}: {
  facts: readonly DiagnosticFact[];
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const copy = useCopyDiagnostics(facts);
  return (
    <CopyButton
      className={className}
      onCopy={copy}
      label={t('app.copyDiagnostics')}
      copiedLabel={t('app.copied')}
      data-testid={testId}
    />
  );
}
