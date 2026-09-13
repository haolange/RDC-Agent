import type { TranslationKey } from '../../../i18n';

export const getLeafName = (value: string): string => value.split(/[\\/]/).filter(Boolean).pop() || value;

export const formatOpenedAt = (timestamp?: number): string => {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleString();
};

export const formatStatusLabel = (
  status: string | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string => {
  if (!status) return '--';
  if (status === 'open') return t('control.captureLibraryOpenedBadge');
  if (status === 'opening') return t('control.captureOpening');
  if (status === 'error') return t('app.degraded');
  if (status === 'closed') return t('app.offline');
  return status;
};

export const formatBackendLabel = (
  backend: string | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string => {
  if (backend === 'local') return t('control.sessionContextBackendLocal');
  if (backend === 'remote') return t('control.sessionContextBackendRemote');
  return backend || '--';
};

export const getSessionContextSummary = (
  openedCapturePath: string | null | undefined,
  inputCount: number,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string => {
  if (openedCapturePath) {
    return getLeafName(openedCapturePath);
  }

  if (inputCount === 1) {
    return t('control.sessionContextSingleCaptureReady');
  }

  if (inputCount > 1) {
    return t('control.sessionContextMultipleCaptureReady').replace('{count}', String(inputCount));
  }

  return t('control.sessionContextNoCapture');
};
