import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type {
  ReasoningControl,
  ReasoningSelection,
} from '@shared/types/modelCapability';
import {
  REASONING_SELECTIONS,
  clampReasoningSelection,
  getReasoningSelectionOrder,
} from '@shared/types/modelCapability';

export function resolveSelectedLevel(
  reasoningLevel: ReasoningSelection,
  reasoningControl: ReasoningControl | null,
  displayLevels: ReasoningSelection[],
): ReasoningSelection {
  if (!reasoningControl) {
    return displayLevels[0] ?? 'off';
  }
  const clamped = clampReasoningSelection(reasoningLevel, reasoningControl)
    ?? reasoningControl.defaultSelection;
  if (displayLevels.includes(clamped)) {
    return clamped;
  }
  return displayLevels[displayLevels.length - 1] ?? 'off';
}

export const EFFORT_LABEL_KEYS = {
  off: 'composer.effort.levelOff',
  on: 'composer.effort.levelOn',
  minimal: 'composer.effort.levelMinimal',
  low: 'composer.effort.levelLow',
  medium: 'composer.effort.levelMedium',
  high: 'composer.effort.levelHigh',
  xhigh: 'composer.effort.levelExtra',
  max: 'composer.effort.levelMax',
} as const;

export interface ModelEffortCapsulePresentation {
  modelLabel: string;
  reasoningLabel: string;
  showFast: boolean;
  showMax: boolean;
  title: string;
}

export function buildModelEffortCapsulePresentation(input: {
  modelLabel: string;
  reasoningLabel: string;
  maxContextMode: boolean;
  maxContextLabel: string;
  fastModel: boolean;
  fastModelLabel: string;
}): ModelEffortCapsulePresentation {
  const parts = [input.modelLabel, input.reasoningLabel];
  if (input.fastModel) parts.push(input.fastModelLabel);
  if (input.maxContextMode) parts.push(input.maxContextLabel);
  return {
    modelLabel: input.modelLabel,
    reasoningLabel: input.reasoningLabel,
    showFast: input.fastModel,
    showMax: input.maxContextMode,
    title: parts.join(' · '),
  };
}

interface EffortModeIconButtonProps {
  mode: 'fast' | 'max-context';
  'data-testid': 'composer-model-effort-fast-mode' | 'composer-model-effort-max-mode';
  label: string;
  statusLabel?: string;
  available: boolean;
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function EffortModeIconButton(props: EffortModeIconButtonProps) {
  const accessibleName = props.statusLabel
    ? `${props.label} · ${props.statusLabel}`
    : props.label;
  return (
    <button
      type="button"
      role="switch"
      className={cn(
        'composer-model-effort-mode',
        props.active && 'is-active',
        !props.available && 'is-disabled',
      )}
      data-mode={props.mode}
      data-testid={props['data-testid']}
      aria-checked={props.active}
      aria-label={accessibleName}
      disabled={!props.available}
      onClick={props.onToggle}
    >
      {props.children}
      <span className="composer-model-effort-mode-tip" role="tooltip">
        {accessibleName}
      </span>
    </button>
  );
}

export function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function buildDisplaySelections(control: ReasoningControl | null | undefined): ReasoningSelection[] {
  const ordered = getReasoningSelectionOrder(control);
  const normalized = REASONING_SELECTIONS.filter((level) => ordered.includes(level));
  return normalized.length > 0 ? normalized : ['off'];
}

export function getStopPosition(index: number, total: number): number {
  return total <= 1 ? 0 : index / (total - 1);
}

export function clampSliderRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
}

export function resolveNearestSnapLevel(ratio: number, supported: ReasoningSelection[]): ReasoningSelection {
  if (supported.length <= 1) {
    return supported[0] ?? 'off';
  }
  const position = clampSliderRatio(ratio) * (supported.length - 1);
  const selectedIndex = Math.max(0, Math.min(supported.length - 1, Math.round(position)));
  return supported[selectedIndex] ?? supported[0] ?? 'off';
}

export function findAdjacentSupportedLevel(
  current: ReasoningSelection,
  direction: -1 | 1,
  supported: ReasoningSelection[],
): ReasoningSelection | null {
  const currentIndex = supported.indexOf(current);
  if (currentIndex < 0) {
    return supported[0] ?? null;
  }
  return supported[currentIndex + direction] ?? null;
}
