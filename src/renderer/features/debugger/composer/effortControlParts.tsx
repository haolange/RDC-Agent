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
  xhigh: 'composer.effort.levelXHigh',
  max: 'composer.effort.levelMax',
  ultra: 'composer.effort.levelUltra',
} as const;

export type EffortPillMode = 'one-million-context' | 'fast';

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

export type ReasoningIconVariant = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'max-plus';

export function resolveReasoningIconVariant(level: ReasoningSelection): ReasoningIconVariant {
  if (level === 'on') {
    return 'medium';
  }
  if (level === 'ultra') {
    return 'max-plus';
  }
  return level;
}

export function buildEffortPillPresentation(input: {
  reasoningLabel: string;
  oneMillionContextMode: boolean;
  oneMillionContextLabel: string;
  oneMillionContextBadgeLabel: string;
  fastModel: boolean;
  fastModelLabel: string;
  fastModelBadgeLabel: string;
}): EffortPillPresentation {
  const badges: EffortPillModeBadge[] = [];
  if (input.oneMillionContextMode) {
    badges.push({
      mode: 'one-million-context',
      label: input.oneMillionContextBadgeLabel,
      title: input.oneMillionContextLabel,
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
        className={`composer-effort-toggle ${props.active ? 'active' : ''}`}
        aria-checked={props.active}
        aria-label={props.statusLabel ? `${props.label} · ${props.statusLabel}` : props.label}
        disabled={!props.available}
        onClick={props.onToggle}
      />
    </>
  );
}

export function EffortOneMillionContextSwitchRow(props: EffortModeSwitchRowProps) {
  return (
    <div
      className={`composer-effort-toggle-row ${props.available ? '' : 'is-disabled'}`}
      data-testid="composer-effort-one-million-row"
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

export function ReasoningLevelIcon({ level }: { level: ReasoningSelection }) {
  const variant = resolveReasoningIconVariant(level);
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-reasoning-icon={variant}>
      {variant === 'off' ? (
        <>
          <circle cx="12" cy="9.5" r="5.1" opacity="0.72" />
          <path d="M9.2 15.1h5.6" opacity="0.72" />
          <path d="M9.8 18h4.4" opacity="0.72" />
        </>
      ) : null}

      {variant === 'minimal' ? (
        <>
          <circle cx="12" cy="11" r="3.8" />
          <path d="M12 14.8v2.8" />
          <path d="M10.3 18h3.4" />
        </>
      ) : null}

      {variant === 'low' ? (
        <>
          <circle cx="10.5" cy="11" r="3.7" />
          <circle cx="17.2" cy="7" r="1.8" />
          <path d="M13.6 9.1 15.7 7.9" />
          <path d="M8.7 14.2h3.6" />
          <path d="M9.4 17h2.2" />
        </>
      ) : null}

      {variant === 'medium' ? (
        <>
          <circle cx="12" cy="12" r="3.2" />
          <circle cx="6.2" cy="9" r="2.1" />
          <circle cx="17.8" cy="9" r="2.1" />
          <path d="M8.1 9.9 9.5 10.8" />
          <path d="M15.9 9.9 14.5 10.8" />
          <path d="M9.4 15.4h5.2" />
        </>
      ) : null}

      {variant === 'high' ? (
        <>
          <circle cx="12" cy="12" r="3" />
          <circle cx="5.5" cy="7" r="1.9" />
          <circle cx="18.5" cy="7" r="1.9" />
          <circle cx="6.5" cy="18" r="1.9" />
          <circle cx="18" cy="17" r="1.7" />
          <path d="M7.1 8.2 9.5 10.1" />
          <path d="M16.9 8.2 14.5 10.1" />
          <path d="M8.1 16.5 10 14.4" />
          <path d="M16.4 15.6 14.4 14.1" />
        </>
      ) : null}

      {variant === 'xhigh' ? (
        <>
          <path d="M6.2 5.7a8.7 8.7 0 0 1 11.6 0" />
          <circle cx="12" cy="12" r="3" />
          <circle cx="5.5" cy="8" r="1.8" />
          <circle cx="18.5" cy="8" r="1.8" />
          <circle cx="6.5" cy="17.2" r="1.8" />
          <circle cx="17.5" cy="17.2" r="1.8" />
          <path d="M7.2 8.9 9.4 10.4" />
          <path d="M16.8 8.9 14.6 10.4" />
          <path d="M8.1 15.8 9.8 14.3" />
          <path d="M15.9 15.8 14.2 14.3" />
        </>
      ) : null}

      {variant === 'max' ? (
        <>
          <circle cx="12" cy="12" r="8.2" />
          <circle cx="12" cy="12" r="2.7" />
          <circle cx="6.7" cy="7.4" r="1.7" />
          <circle cx="17.3" cy="7.4" r="1.7" />
          <circle cx="6.9" cy="16.8" r="1.7" />
          <circle cx="17.1" cy="16.8" r="1.7" />
          <path d="M8.1 8.6 9.9 10.2" />
          <path d="M15.9 8.6 14.1 10.2" />
          <path d="M8.4 15.6 9.8 13.9" />
          <path d="M15.6 15.6 14.2 13.9" />
          <path d="M8.6 7.4h6.8" />
          <path d="M8.7 16.8h6.6" />
        </>
      ) : null}

      {variant === 'max-plus' ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="10.2" opacity="0.55" />
          <circle cx="12" cy="12" r="2.5" />
          <circle cx="6.4" cy="7.3" r="1.6" />
          <circle cx="17.6" cy="7.3" r="1.6" />
          <circle cx="6.6" cy="16.9" r="1.6" />
          <circle cx="17.4" cy="16.9" r="1.6" />
          <circle cx="12" cy="4.5" r="1.3" />
          <path d="M7.8 8.4 9.8 10.2" />
          <path d="M16.2 8.4 14.2 10.2" />
          <path d="M8.3 15.7 9.7 13.9" />
          <path d="M15.7 15.7 14.3 13.9" />
          <path d="M8.2 7.3h7.6" />
          <path d="M8.3 16.9h7.4" />
          <path d="M12 5.8v3.5" />
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
