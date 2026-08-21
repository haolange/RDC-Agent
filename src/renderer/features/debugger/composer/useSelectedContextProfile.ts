import { resolvedCapability } from './capabilityResolution';
import { resolveSelectedContextProfile, type SelectedContextProfile } from './selectedContextProfile';
import { useTurnControlsStore } from './useTurnControls';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { DEFAULT_CONTEXT_COMPACTION_PERCENT } from '@shared/types/modelCapability';

export type { SelectedContextProfile };

export function useSelectedContextProfile(): SelectedContextProfile | null {
  const capabilityState = useTurnControlsStore((state) => state.capabilityState);
  const controls = useTurnControlsStore((state) => state.turnControls);
  const compactionThresholdPercent = useAppSettingsStore(
    (state) => state.settings.agentRuntime.context?.compactionThresholdPercent
      ?? DEFAULT_CONTEXT_COMPACTION_PERCENT,
  );
  const capability = resolvedCapability(capabilityState);
  if (!capability) return null;
  return resolveSelectedContextProfile(capability, controls, compactionThresholdPercent);
}
