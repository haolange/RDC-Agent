import { randomUUID } from 'node:crypto';
import { GENERAL_AGENT_ID } from '@shared/types/agent';
import { AppError } from '@shared/errors/appError';
import {
  sameRdcLifecyclePosition,
  type RdcLifecyclePoint,
  type RdcLifecycleReceipt,
} from '../../rdc/RdcLifecycleReceipts';
import { getRdcTurnBinding, type RdcTurnBinding } from '../../rdc/RdcTurnBindings';
import { observedRdcProcessIdentity } from '../../rdc/RdcProcessIdentity';
import type { InvestigationPlanContract } from '../../sessions/run/investigationPlanContract';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';
import type { TaskRuntimeEpoch } from '../tasks/taskExecutionSchemas';
import type { RdcRecoveryObservation } from '../../rdc/RdcContextStatus';
import type { RdcRecoveryClassification } from '../../rdc/RdcRecoveryClassification';
import type { EffectiveRuntimePlan } from '../EffectiveRuntimePlan';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { ToolExecutionContext } from '../agent/AgentTool';
import type { TurnHandle } from './TurnCoordinator';

type Destination = { inputId: string; contentSha256: string; deviceId: string };
type Prepared = { plan: EffectiveRuntimePlan; prompt: PromptPlan; binding: RdcTurnBinding };
export type RecoveryFacts = {
  cause: { operation: string; argsFingerprint: string; code: string };
  observed: RdcRecoveryObservation;
  classification: RdcRecoveryClassification;
};
export interface ApprovedCaptureHost {
  assertPlan(): void;
  assertNoPendingRecovery(): void;
  prepareReceipts(): void;
  quiescent(mode?: 'recovery'): Promise<void>;
  snapshot(binding: RdcTurnBinding, signal?: AbortSignal): Promise<RdcLifecyclePoint | null>;
  verifyDestination(destination: Destination): Promise<void>;
  open(
    destination: Destination,
    binding: RdcTurnBinding,
    signal: AbortSignal | undefined,
    onStopped: (contextId: string) => void,
  ): Promise<void>;
  close(
    binding: RdcTurnBinding,
    signal: AbortSignal | undefined,
    onStopped: (contextId: string) => void,
  ): Promise<void>;
  restorePosition(point: RdcLifecyclePoint, binding: RdcTurnBinding, signal?: AbortSignal): Promise<void>;
  recoveryGuard(expectedRevision: number): () => void;
  joinRecoveryChild(signal?: AbortSignal): Promise<void>;
  inspectRecovery(point: RdcLifecyclePoint, binding: RdcTurnBinding, signal?: AbortSignal): Promise<RecoveryFacts>;
  reopenAfterFailure(
    destination: Destination,
    binding: RdcTurnBinding,
    signal: AbortSignal | undefined,
    onStopped: (contextId: string) => void,
    guard: () => void,
  ): Promise<void>;
  reprepare(
    previous: { plan: EffectiveRuntimePlan; prompt: PromptPlan; binding: RdcTurnBinding },
    signal?: AbortSignal,
  ): Promise<Prepared>;
  appendEpoch(epoch: TaskRuntimeEpoch): Promise<void>;
  writeReceipt(receipt: RdcLifecycleReceipt): InvestigationContentRef;
  /** A failed transition is a fault of the owning lease it left uncertain (`cause` is the failure's code). */
  quarantineChanged(
    previous: RdcLifecyclePoint | null,
    failure: { cause: string; reason: string },
    force?: boolean,
  ): void;
}

/** One approved goal owns one serial capture transition chain. */
export class ApprovedCaptureController {
  private original: RdcLifecyclePoint | null | undefined;
  private baseline: InvestigationContentRef | null = null;
  private lastVerified: RdcLifecyclePoint | null = null;
  private recoveryAdmission: { revision: number; guard: () => void } | null = null;
  private initialError: string | null = null;
  private lastFailure: string | null = null;
  private restoreError: string | null = null;
  constructor(
    private readonly input: {
      sessionId: string;
      projectId: string;
      planUri: string;
      planHash: string;
      captureScope: NonNullable<InvestigationPlanContract['captureScope']>;
      turn: TurnHandle;
      host: ApprovedCaptureHost;
    },
  ) {}

  /** Capture the user's original position before the model starts; errors only block switching. */
  async initialize(): Promise<void> {
    try {
      this.input.host.assertPlan();
      this.input.host.assertNoPendingRecovery();
      this.original = await this.input.host.snapshot(this.current().binding, this.input.turn.signal);
      this.lastVerified = this.original;
      this.input.host.prepareReceipts();
      this.baseline = this.input.host.writeReceipt({
        ...this.base(randomUUID()),
        event: 'baseline',
        original: this.original,
      });
    } catch (error) {
      this.initialError = error instanceof Error ? error.message : String(error);
    }
  }

  async select(
    inputId: string,
    signal?: AbortSignal,
  ): Promise<{ changed: boolean; receipt?: InvestigationContentRef; current: RdcLifecyclePoint | null }> {
    this.assertReady();
    const chosen = this.input.captureScope.inputs.find((item) => item.inputId === inputId);
    if (!chosen) throw new AppError('RDC_CAPTURE_NOT_APPROVED', 'input is not in the approved plan.');
    const destination = { inputId, contentSha256: chosen.contentSha256, deviceId: this.input.captureScope.deviceId };
    this.input.host.assertPlan();
    await this.input.host.verifyDestination(destination);
    const from = await this.input.host.snapshot(this.current().binding, signal);
    this.lastVerified = from;
    if (sameCapture(from, destination)) return { changed: false, current: from };
    if (this.original?.native.replacementCount)
      throw new AppError('RDC_ORIGINAL_REPLACEMENTS_UNRESTORABLE', 'the original capture has active replacements.');
    const transition = await this.transition(from, destination, false, signal);
    return { changed: true, ...transition };
  }

  get lastRestoreError(): string | null {
    return this.restoreError;
  }

  assertLiveAccess(): void {
    this.assertReady();
  }

  /** The signed entry point belongs only to the approved owning General turn. */
  restorationBaselineFor(
    scope: Pick<ToolExecutionContext, 'sessionId' | 'projectId' | 'turnId' | 'agentId' | 'accessCeiling'>,
  ) {
    if (
      scope.sessionId !== this.input.sessionId ||
      scope.projectId !== this.input.projectId ||
      scope.turnId !== this.input.turn.turnId ||
      scope.agentId !== GENERAL_AGENT_ID ||
      scope.accessCeiling !== 'full'
    )
      return null;
    if (!this.input.turn.isLive(this.input.turn.generation))
      return { available: false as const, reason: 'RDC_TURN_NOT_ACTIVE' };
    if (this.initialError || this.original === undefined || !this.baseline)
      return { available: false as const, reason: 'RDC_INITIAL_STATE_UNVERIFIED' };
    return { available: true as const, original: structuredClone(this.original), receipt: { ...this.baseline } };
  }

  /** Close the durable recovery record only after the final user position is observed. */
  async recordTerminalRestoration(signal?: AbortSignal): Promise<boolean> {
    if (!this.baseline || this.original === undefined || this.initialError) return false;
    this.assertReady();
    this.input.host.assertPlan();
    const observed = await this.input.host.snapshot(this.current().binding, signal);
    if (!sameRdcLifecyclePosition(observed, this.original)) return false;
    this.input.host.writeReceipt({ ...this.base(randomUUID()), event: 'resolved', baseline: this.baseline, observed });
    return true;
  }

  async restorationStatus(signal?: AbortSignal) {
    this.assertReady();
    this.input.host.assertPlan();
    const current = await this.input.host.snapshot(this.current().binding, signal);
    this.lastVerified = current;
    return {
      restored: samePosition(current, this.original!),
      original: structuredClone(this.original!),
      current: structuredClone(current),
      receipt: { ...this.baseline! },
    };
  }

  async restore(signal?: AbortSignal): Promise<{ changed: boolean; receipt?: InvestigationContentRef }> {
    try {
      const result = await this.restorePosition(signal);
      this.restoreError = null;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.restoreError = /^[A-Z][A-Z0-9_]{0,127}/u.exec(message)?.[0] ?? 'RDC_RESTORE_UNCONFIRMED';
      throw error;
    }
  }

  private async restorePosition(
    signal?: AbortSignal,
  ): Promise<{ changed: boolean; receipt?: InvestigationContentRef }> {
    this.assertReady();
    this.input.host.assertPlan();
    const from = await this.input.host.snapshot(this.current().binding, signal);
    this.lastVerified = from;
    if (samePosition(from, this.original!)) return { changed: false };
    if (this.original && sameCapture(from, this.original)) {
      await this.input.host.quiescent();
      if (!from || from.native.replacementFingerprint !== this.original.native.replacementFingerprint) {
        throw new AppError('RDC_ORIGINAL_REPLACEMENTS_UNRESTORABLE', 'replacement state differs from the saved state.');
      }
      // Event observation selects a target automatically; reopening can recover a
      // signed entry with no selected target without claiming that target was cleared.
      if (!this.original.target && !this.original.isFinalOutput && !this.original.native.replacementCount) {
        await this.input.host.verifyDestination(destinationOf(this.original));
        const transition = await this.transition(from, destinationOf(this.original), true, signal);
        return { changed: true, receipt: transition.receipt };
      }
      this.input.host.prepareReceipts();
      const operationId = randomUUID();
      const base = this.base(operationId);
      const intent = this.input.host.writeReceipt({
        ...base,
        event: 'intent',
        original: this.original,
        from,
        destination: destinationOf(this.original),
      });
      try {
        await this.input.host.restorePosition(this.original, this.current().binding, signal);
        const to = await this.input.host.snapshot(this.current().binding, signal);
        if (
          !to ||
          !samePosition(to, this.original) ||
          from.native.contextId !== to.native.contextId ||
          from.native.leaseVersion !== to.native.leaseVersion ||
          JSON.stringify(from.native.processIdentity) !== JSON.stringify(to.native.processIdentity)
        ) {
          throw new AppError(
            'RDC_RESTORE_UNCONFIRMED',
            'position, target or process identity does not match the saved state.',
          );
        }
        this.lastVerified = to;
        return {
          changed: true,
          receipt: this.input.host.writeReceipt({
            ...base,
            recordedAt: Date.now(),
            event: 'position-restored',
            intent,
            from,
            to,
            runtimeFingerprint: this.current().plan.fingerprint,
          }),
        };
      } catch (error) {
        this.fail(intent, base, from, error, true);
        throw error;
      }
    }
    if (this.original?.native.replacementCount)
      throw new AppError(
        'RDC_ORIGINAL_REPLACEMENTS_UNRESTORABLE',
        'cannot reconstruct original replacements after a capture switch.',
      );
    if (this.original) await this.input.host.verifyDestination(destinationOf(this.original));
    const transition = await this.transition(from, this.original ? destinationOf(this.original) : null, true, signal);
    return { changed: true, receipt: transition.receipt };
  }

  /** Join the faulted child before acquiring the shared unsafe-effects lock. */
  async prepareRecovery(permissionRevision: number, signal?: AbortSignal): Promise<void> {
    this.assertReady();
    this.input.host.assertPlan();
    if (this.recoveryAdmission) {
      if (this.recoveryAdmission.revision !== permissionRevision) throw new AppError('RDC_RECOVERY_PERMISSION_CHANGED');
      this.recoveryAdmission.guard();
      return;
    }
    const guard = this.input.host.recoveryGuard(permissionRevision);
    guard();
    const from = this.verified();
    if (
      !from ||
      !this.input.captureScope.inputs.some(
        (item) => item.inputId === from.inputId && item.contentSha256 === from.contentSha256,
      ) ||
      from.deviceId !== this.input.captureScope.deviceId
    )
      throw new AppError('RDC_RECOVERY_SCOPE_INVALID', 'no verified approved capture is available.');
    await this.input.host.joinRecoveryChild(signal);
    guard();
    this.recoveryAdmission = { revision: permissionRevision, guard };
  }

  /** Reopen only a main-observed fault on the same approved input and device. */
  async recover(
    signal?: AbortSignal,
  ): Promise<{ changed: true; receipt: InvestigationContentRef; current: RdcLifecyclePoint }> {
    const admission = this.recoveryAdmission;
    if (!admission) throw new AppError('RDC_RECOVERY_PREPARATION_REQUIRED');
    try {
      return await this.performRecovery(admission.guard, signal);
    } finally {
      this.recoveryAdmission = null;
    }
  }

  private async performRecovery(
    guard: () => void,
    signal?: AbortSignal,
  ): Promise<{ changed: true; receipt: InvestigationContentRef; current: RdcLifecyclePoint }> {
    this.assertReady();
    guard();
    const from = this.verified()!;
    await this.input.host.quiescent('recovery');
    guard();
    const previous = this.current();
    const facts = await this.input.host.inspectRecovery(from, previous.binding, signal);
    guard();
    this.input.host.prepareReceipts();
    const operationId = randomUUID();
    const base = this.base(operationId);
    const destination = destinationOf(from);
    const intent = this.input.host.writeReceipt({
      ...base,
      event: 'intent',
      original: this.original!,
      from,
      destination,
      recovery: { cause: facts.cause, observed: facts.observed, classification: facts.classification },
    });
    if (facts.classification.decision === 'quarantined') {
      const refused = new AppError(facts.classification.code, facts.classification.reason);
      this.fail(intent, base, from, refused, true);
      throw refused;
    }
    let stopped: InvestigationContentRef | undefined;
    const onStopped = (contextId: string) => {
      if (stopped || contextId !== from.native.contextId) throw new AppError('RDC_RECOVERY_STOP_RECEIPT_MISMATCH');
      stopped = this.input.host.writeReceipt({
        ...base,
        recordedAt: Date.now(),
        event: 'daemon-stopped',
        intent,
        contextId,
        stopped: true,
      });
    };
    try {
      signal?.throwIfAborted();
      guard();
      await this.input.host.reopenAfterFailure(destination, previous.binding, signal, onStopped, guard);
      signal?.throwIfAborted();
      guard();
      const next = await this.input.host.reprepare(previous, signal);
      guard();
      const to = await this.input.host.snapshot(next.binding, signal);
      guard();
      if (!to || !sameCapture(to, destination) || !stopped || to.native.contextId === from.native.contextId) {
        throw new AppError(
          'RDC_RECOVERY_RESULT_UNVERIFIED',
          'the same input and device must reopen under a new confirmed context.',
        );
      }
      const recordedAt = Date.now();
      const receipt = this.input.host.writeReceipt({
        ...base,
        recordedAt,
        event: 'transition',
        intent,
        from,
        to,
        previousFingerprint: previous.plan.fingerprint,
        runtimeFingerprint: next.plan.fingerprint,
        daemonStopped: stopped,
        restored: false,
      });
      const epoch: TaskRuntimeEpoch = {
        previousFingerprint: previous.plan.fingerprint,
        runtimeFingerprint: next.plan.fingerprint,
        receipt,
        recordedAt,
      };
      await this.input.host.appendEpoch(epoch);
      this.input.turn.runtimePlan = next.plan;
      this.input.turn.promptPlan = next.prompt;
      if (this.input.turn.taskPreparation)
        this.input.turn.taskPreparation = {
          ...this.input.turn.taskPreparation,
          runtimeFingerprint: next.plan.fingerprint,
        };
      this.input.turn.runtimeEpochs.push(epoch);
      this.lastVerified = to;
      return { changed: true, receipt, current: to };
    } catch (error) {
      this.fail(intent, base, from, error, true);
      throw error;
    }
  }

  private async transition(
    from: RdcLifecyclePoint | null,
    destination: Destination | null,
    restored: boolean,
    signal?: AbortSignal,
  ): Promise<{ receipt: InvestigationContentRef; current: RdcLifecyclePoint | null }> {
    await this.input.host.quiescent();
    if (from?.native.replacementCount)
      throw new AppError('RDC_SWITCH_REPLACEMENTS_ACTIVE', 'restore replacements before changing capture.');
    const failureKey = JSON.stringify({ inputId: destination?.inputId ?? null, from: from?.inputId ?? null });
    if (this.lastFailure === failureKey)
      throw new AppError('RDC_SWITCH_REPEATED_FAILURE', 'the same transition already failed in this turn.');
    this.input.host.prepareReceipts();
    const previous = this.current();
    const operationId = randomUUID();
    const base = this.base(operationId);
    const intent = this.input.host.writeReceipt({
      ...base,
      event: 'intent',
      original: this.original!,
      from,
      destination,
    });
    let stopped: InvestigationContentRef | undefined;
    const onStopped = (contextId: string) => {
      if (!from || stopped || contextId !== from.native.contextId)
        throw new AppError('RDC_SWITCH_STOP_RECEIPT_MISMATCH');
      stopped = this.input.host.writeReceipt({
        ...base,
        recordedAt: Date.now(),
        event: 'daemon-stopped',
        intent,
        contextId,
        stopped: true,
      });
    };
    try {
      signal?.throwIfAborted();
      if (destination) await this.input.host.open(destination, previous.binding, signal, onStopped);
      else await this.input.host.close(previous.binding, signal, onStopped);
      signal?.throwIfAborted();
      const next = await this.input.host.reprepare(previous, signal);
      const opened = await this.input.host.snapshot(next.binding, signal);
      if (restored && this.original && !samePosition(opened, this.original)) {
        await this.input.host.restorePosition(this.original, next.binding, signal);
      }
      const to = restored && this.original ? await this.input.host.snapshot(next.binding, signal) : opened;
      if (
        opened &&
        to &&
        (opened.native.contextId !== to.native.contextId ||
          opened.native.leaseVersion !== to.native.leaseVersion ||
          JSON.stringify(opened.native.processIdentity) !== JSON.stringify(to.native.processIdentity))
      )
        throw new AppError('RDC_RESTORE_PROCESS_MISMATCH');
      if (destination ? !sameCapture(to, destination) : to !== null)
        throw new AppError('RDC_SWITCH_RESULT_MISMATCH', 'the requested capture is not the verified current input.');
      if (restored && !samePosition(to, this.original!))
        throw new AppError('RDC_RESTORE_UNCONFIRMED', 'original capture position or target was not restored.');
      if (from && (!to || from.native.contextId !== to.native.contextId) && !stopped)
        throw new AppError('RDC_SWITCH_STOP_RECEIPT_MISSING');
      if (
        from &&
        to &&
        from.native.contextId === to.native.contextId &&
        (JSON.stringify(from.native.processIdentity) !== JSON.stringify(to.native.processIdentity) ||
          from.native.replaySessionId === to.native.replaySessionId)
      )
        throw new AppError('RDC_SWITCH_PROCESS_MISMATCH');
      const recordedAt = Date.now();
      const receipt = this.input.host.writeReceipt({
        ...base,
        recordedAt,
        event: 'transition',
        intent,
        from,
        to,
        previousFingerprint: previous.plan.fingerprint,
        runtimeFingerprint: next.plan.fingerprint,
        ...(stopped ? { daemonStopped: stopped } : {}),
        restored,
      });
      const epoch: TaskRuntimeEpoch = {
        previousFingerprint: previous.plan.fingerprint,
        runtimeFingerprint: next.plan.fingerprint,
        receipt,
        recordedAt,
      };
      await this.input.host.appendEpoch(epoch);
      this.input.turn.runtimePlan = next.plan;
      this.input.turn.promptPlan = next.prompt;
      if (this.input.turn.taskPreparation)
        this.input.turn.taskPreparation = {
          ...this.input.turn.taskPreparation,
          runtimeFingerprint: next.plan.fingerprint,
        };
      this.input.turn.runtimeEpochs.push(epoch);
      this.lastVerified = to;
      this.lastFailure = null;
      return { receipt, current: to };
    } catch (error) {
      this.lastFailure = failureKey;
      this.fail(intent, base, from, error);
      throw error;
    }
  }

  private fail(
    intent: InvestigationContentRef,
    base: ReturnType<ApprovedCaptureController['base']>,
    from: RdcLifecyclePoint | null,
    error: unknown,
    force = false,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    const code = /^[A-Z][A-Z0-9_]{0,127}/u.exec(message)?.[0] ?? 'RDC_SWITCH_FAILED';
    this.input.host.quarantineChanged(from, { cause: code, reason: message }, force);
    this.input.host.writeReceipt({ ...base, recordedAt: Date.now(), event: 'failed', intent, code });
  }
  /** The last verified point, carrying the latest process identity a successful result reported for its context. */
  private verified(): RdcLifecyclePoint | null {
    const point = this.lastVerified;
    const observed = point && observedRdcProcessIdentity(point.native.contextId);
    return point && observed ? { ...point, native: { ...point.native, processIdentity: observed } } : point;
  }
  private current(): Prepared {
    const plan = this.input.turn.runtimePlan;
    const prompt = this.input.turn.promptPlan;
    const binding = plan ? getRdcTurnBinding(plan) : undefined;
    if (!plan || !prompt || !binding)
      throw new AppError('RDC_REPREPARE_FROZEN_PLAN_CHANGED', 'prepared turn is missing.');
    return { plan, prompt, binding };
  }
  private assertReady(): void {
    if (this.initialError || this.original === undefined)
      throw new AppError('RDC_INITIAL_STATE_UNVERIFIED', this.initialError ?? 'initial state was not recorded');
    if (!this.input.turn.isLive(this.input.turn.generation)) throw new AppError('RDC_TURN_NOT_ACTIVE');
  }
  private base(operationId: string) {
    return {
      sessionId: this.input.sessionId,
      projectId: this.input.projectId,
      turnId: this.input.turn.turnId,
      operationId,
      planUri: this.input.planUri,
      planHash: this.input.planHash.replace(/^sha256:/u, ''),
      recordedAt: Date.now(),
    };
  }
}

function destinationOf(point: RdcLifecyclePoint): Destination {
  return { inputId: point.inputId, contentSha256: point.contentSha256, deviceId: point.deviceId };
}
function sameCapture(point: RdcLifecyclePoint | null, expected: Destination): boolean {
  return (
    !!point &&
    point.inputId === expected.inputId &&
    point.contentSha256 === expected.contentSha256 &&
    point.deviceId === expected.deviceId
  );
}
function samePosition(left: RdcLifecyclePoint | null, right: RdcLifecyclePoint | null): boolean {
  return sameRdcLifecyclePosition(left, right);
}
