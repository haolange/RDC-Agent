import type { TranslationKey } from '../../../i18n';
import type { CapabilityResolutionState } from './capabilityResolution';

export interface CapabilityStatusPresentation {
  labelKey?: TranslationKey;
  detailKey?: TranslationKey;
  refreshing: boolean;
}

export function capabilityStatusPresentation(
  state: CapabilityResolutionState,
): CapabilityStatusPresentation {
  switch (state.status) {
    case 'syncing-route':
      return { labelKey: 'composer.effort.capabilitySyncing', refreshing: false };
    case 'loading':
      return { labelKey: 'composer.effort.capabilityLoading', refreshing: false };
    case 'unconfigured':
      return { labelKey: 'composer.effort.capabilityUnconfigured', refreshing: false };
    case 'unavailable':
      return {
        labelKey: 'composer.effort.capabilityUnavailable',
        detailKey: 'composer.effort.capabilityUnavailableDetail',
        refreshing: false,
      };
    case 'error':
      return {
        labelKey: 'composer.effort.capabilityError',
        detailKey: 'composer.effort.capabilityErrorDetail',
        refreshing: false,
      };
    case 'refreshing':
      return { refreshing: true };
    case 'ready':
      return { refreshing: false };
  }
}
