import { useI18n } from '../i18n';
export function useUiLabels() {
  const { t } = useI18n();
  return { selectPlaceholder: t('app.selectPlaceholder'), selectEmpty: t('app.selectEmpty') };
}
