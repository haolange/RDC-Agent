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

export type EffortPillMode = 'max-context' | 'fast';

export interface EffortPillModeBadge {
  mode: EffortPillMode;
  label: string;
  title: string;
}

export interface EffortPillPresentation {
  label: string;
  title: string;
  badges: EffortPillModeBadge[];
}

export type ReasoningIconVariant = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function resolveReasoningIconVariant(level: ReasoningSelection): ReasoningIconVariant {
  if (level === 'on') {
    return 'medium';
  }
  return level;
}

export function buildEffortPillPresentation(input: {
  reasoningLabel: string;
  maxContextMode: boolean;
  maxContextLabel: string;
  maxContextBadgeLabel: string;
  fastModel: boolean;
  fastModelLabel: string;
  fastModelBadgeLabel: string;
}): EffortPillPresentation {
  const badges: EffortPillModeBadge[] = [];
  if (input.maxContextMode) {
    badges.push({
      mode: 'max-context',
      label: input.maxContextBadgeLabel,
      title: input.maxContextLabel,
    });
  }
  if (input.fastModel) {
    badges.push({
      mode: 'fast',
      label: input.fastModelBadgeLabel,
      title: input.fastModelLabel,
    });
  }
  return {
    label: input.reasoningLabel,
    title: [input.reasoningLabel, ...badges.map((badge) => badge.title)].join(' | '),
    badges,
  };
}

interface EffortModeSwitchRowProps {
  label: string;
  statusLabel?: string;
  available: boolean;
  active: boolean;
  onToggle: () => void;
}

function EffortModeSwitchRowBody(props: EffortModeSwitchRowProps) {
  return (
    <>
      <div className="composer-effort-toggle-copy">
        <span className="composer-effort-toggle-label">{props.label}</span>
        {props.statusLabel ? (
          <span className="composer-effort-toggle-status">{props.statusLabel}</span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        className={cn('composer-effort-toggle', props.active && 'is-active')}
        aria-checked={props.active}
        aria-label={props.statusLabel ? `${props.label} · ${props.statusLabel}` : props.label}
        disabled={!props.available}
        onClick={props.onToggle}
      />
    </>
  );
}

export function EffortMaxContextSwitchRow(props: EffortModeSwitchRowProps) {
  return (
    <div
      className={`composer-effort-toggle-row ${props.available ? '' : 'is-disabled'}`}
      data-testid="composer-effort-max-context-row"
    >
      <EffortModeSwitchRowBody {...props} />
    </div>
  );
}

export function EffortFastModeSwitchRow(props: EffortModeSwitchRowProps) {
  return (
    <div
      className={`composer-effort-toggle-row ${props.available ? '' : 'is-disabled'}`}
      data-testid="composer-effort-fast-row"
    >
      <EffortModeSwitchRowBody {...props} />
    </div>
  );
}

/**
 * Reasoning icons share optical center (12,12) in a 24 viewBox.
 * Density grows with level; stroke stays integer 2 for crisp 16px @ 1.5dpr.
 */
export function ReasoningLevelIcon({ level }: { level: ReasoningSelection }) {
  const variant = resolveReasoningIconVariant(level);
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-reasoning-icon={variant}
    >
      {variant === 'off' ? (
        <>
          <circle cx="12" cy="12" r="3" opacity="0.55" />
          <circle cx="12" cy="12" r="8" opacity="0.4" />
        </>
      ) : (
        <circle cx="12" cy="12" r="3" />
      )}

      {variant === 'minimal' ? (
        <path d="M12 5v3M12 16v3" />
      ) : null}

      {variant === 'low' ? (
        <>
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v2" />
        </>
      ) : null}

      {variant === 'medium' ? (
        <>
          <circle cx="6" cy="8" r="2" />
          <circle cx="18" cy="8" r="2" />
          <path d="M8 9 10 11M16 9 14 11" />
        </>
      ) : null}

      {variant === 'high' ? (
        <>
          <circle cx="6" cy="7" r="2" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="7" cy="17" r="2" />
          <circle cx="17" cy="17" r="2" />
          <path d="M8 9 10 11M16 9 14 11M9 15 10 14M15 15 14 14" />
        </>
      ) : null}

      {variant === 'xhigh' ? (
        <>
          <path d="M7 5a8 8 0 0 1 10 0" />
          <circle cx="6" cy="8" r="2" />
          <circle cx="18" cy="8" r="2" />
          <circle cx="7" cy="17" r="2" />
          <circle cx="17" cy="17" r="2" />
          <path d="M8 9 10 11M16 9 14 11M9 15 10 14M15 15 14 14" />
        </>
      ) : null}

      {variant === 'max' ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="6" cy="7" r="2" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="7" cy="17" r="2" />
          <circle cx="17" cy="17" r="2" />
          <path d="M8 9 10 11M16 9 14 11M9 15 10 14M15 15 14 14" />
        </>
      ) : null}
    </svg>
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
