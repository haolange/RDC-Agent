import { useTurnControlsStore } from './useTurnControls';
import {
  contextTierWindowTokens,
  resolveContextTierChoices,
} from '@shared/utils/contextTiers';
import { resolveModelControls } from '@shared/utils/modelControls';

export function useSelectedContextWindowTokens(): number | null {
  const capability = useTurnControlsStore((state) => state.capability);
  const controls = useTurnControlsStore((state) => state.turnControls);
  if (!capability) return null;

  const choices = resolveContextTierChoices(capability);
  const resolved = resolveModelControls(capability, controls).resolved.context1m;
  const selectedTierId = resolved.value ? resolved.tierId : choices.normalTier?.id;
  const selectedTier = capability.contextTiers.find((tier) => tier.id === selectedTierId)
    ?? choices.normalTier;
  return selectedTier ? contextTierWindowTokens(selectedTier) ?? null : null;
}
