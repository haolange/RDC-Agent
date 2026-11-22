import { useI18n } from '../i18n';
export function useUiLabels() {
  const { t } = useI18n();
  return {
    selectPlaceholder: t('app.selectPlaceholder'),
    selectEmpty: t('app.selectEmpty'),
    retry: t('app.retry'),
    copyDetails: t('app.copyDetails'),
    copied: t('app.copied'),
    imageViewer: {
      close: t('app.imageViewer.close'),
      previous: t('app.imageViewer.previous'),
      next: t('app.imageViewer.next'),
      zoomIn: t('app.imageViewer.zoomIn'),
      zoomOut: t('app.imageViewer.zoomOut'),
      reset: t('app.imageViewer.reset'),
      openOriginal: t('app.imageViewer.openOriginal'),
      position: (current: number, total: number) => t('app.imageViewer.position', { current, total }),
    },
  };
}
