import { resolvedCapability } from '../../lib/capabilityResolution';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { resolveSelectedContextProfile, type SelectedContextProfile } from './selectedContextProfile';

export type { SelectedContextProfile };

export function useSelectedContextProfile(): SelectedContextProfile | null {
  const capabilityState = useTurnControlsStore((state) => state.capabilityState);
  const controls = useTurnControlsStore((state) => state.turnControls);
  const compactionThresholdPercent = useAppSettingsStore(
    (state) => state.settings.agentRuntime.context.compactionThresholdPercent,
  );
  const capability = resolvedCapability(capabilityState);
  if (!capability) return null;
  return resolveSelectedContextProfile(capability, controls, compactionThresholdPercent);
}
