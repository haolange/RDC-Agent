import { randomUUID } from 'node:crypto';
import { GENERAL_AGENT_ID } from '@shared/types/agent';
import { AppError } from '@shared/errors/appError';
import {
  sameRdcLifecyclePosition,
  type RdcLifecyclePoint,
  type RdcLifecycleReceipt,
  type RdcLifecycleReceipts,
  type RdcLostWithProcess,
} from '../../rdc/RdcLifecycleReceipts';
import { getRdcTurnBinding, type RdcTurnBinding } from '../../rdc/RdcTurnBindings';
import { observedRdcProcessIdentity } from '../../rdc/RdcProcessIdentity';
import { lifecycleLedger, type LifecycleLedger } from '../../runtime/LifecycleLedger';
import { RDC_RECOVERY_ATTEMPT_LIMIT } from '../../rdc/RdcRecoveryClassification';
import type { InvestigationPlanContract } from '../../sessions/run/investigationPlanContract';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';
import type { TaskRuntimeEpoch } from '../tasks/taskExecutionSchemas';
import type { RdcRecoveryObservation } from '../../rdc/RdcContextStatus';
import type { RdcRecoveryClassification } from '../../rdc/RdcRecoveryClassification';
import type { RdcProcessIdentity } from '../../rdc/RdcProcessIdentity';
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
  /** Signed recovery attempts already made on this input, content and device. */
  attempts: number;
};
export interface ApprovedCaptureHost {
  assertPlan(): void;
  /** The earliest unresolved signed baseline of this session and project, if any. */
  pendingRecord(): ReturnType<RdcLifecycleReceipts['pending']>;
  /** The owning lease when it is quarantined: only recovery may act on it. */
  quarantinedContext(): { contextId: string; leaseVersion: number } | null;
  /** The session's replay is quarantined or failed into the error phase. */
  sessionFaulted(): boolean;
  /** Restores an unresolved baseline of any plan, or rebuilds a faulted replay, under this turn's lock. */
  recoverSession(): Promise<void>;
  prepareReceipts(): void;
  /** Throws while children or experiments are open; in recovery mode it returns the open experiments instead. */
  quiescent(
    mode?: 'recovery',
  ): Promise<{ openExperiments: Array<{ experimentId: string; status: 'running' | 'polluted' }> }>;
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
  /** `fault` is the classified process failure, so a silent daemon is stopped or an exited one closed without it. */
  reopenAfterFailure(
    destination: Destination,
    binding: RdcTurnBinding,
    signal: AbortSignal | undefined,
    onStopped: (contextId: string) => void,
    guard: () => void,
    fault: { classification: RdcRecoveryClassification; processes: RdcProcessIdentity },
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
  /** Set when this turn adopted an earlier turn's unresolved baseline whose lease is quarantined. */
  private adoptedBaselineTurnId: string | null = null;
  private pendingRecovery = false;
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
      ledger?: Pick<LifecycleLedger, 'record'>;
    },
  ) {}

  /**
   * Before the model starts: a faulted replay or an unresolved baseline left by any earlier turn is recovered by the
   * host first, then the user's original position is observed and signed as this turn's baseline. A recovery that
   * fails ends the turn here, before any tool runs against a replay that cannot be used.
   */
  async initialize(): Promise<void> {
    this.input.host.assertPlan();
    const quarantined = this.input.host.quarantinedContext();
    const record = this.input.host.pendingRecord();
    if (quarantined && record && this.continuesChain(record, quarantined)) return this.adoptPendingRecovery(record);
    if (record || this.input.host.sessionFaulted()) await this.input.host.recoverSession();
    this.original = await this.input.host.snapshot(this.current().binding, this.input.turn.signal);
    this.lastVerified = this.original;
    this.input.host.prepareReceipts();
    this.baseline = this.input.host.writeReceipt({
      ...this.base(randomUUID()),
      event: 'baseline',
      original: this.original,
    });
  }

  /** The unresolved chain is this plan's, and its last signed position names the quarantined lease. */
  private continuesChain(
    record: NonNullable<ReturnType<ApprovedCaptureHost['pendingRecord']>>,
    quarantined: { contextId: string; leaseVersion: number },
  ): boolean {
    return (
      record.baseline.planUri === this.input.planUri &&
      record.baseline.planHash === this.planHash() &&
      record.latest?.native.contextId === quarantined.contextId &&
      record.latest.native.leaseVersion === quarantined.leaseVersion
    );
  }

  /**
   * A new turn of the same plan that meets its quarantined lease continues the unresolved chain: the earlier
   * baseline stays the user's original, the last signed position on that lease is the last verified one, and only
   * recovery may act until the lease is rebuilt.
   */
  private adoptPendingRecovery(record: NonNullable<ReturnType<ApprovedCaptureHost['pendingRecord']>>): void {
    this.original = record.baseline.original;
    this.baseline = record.ref;
    this.adoptedBaselineTurnId = record.baseline.turnId;
    this.lastVerified = record.latest;
    this.pendingRecovery = true;
  }

  async select(
    inputId: string,
    signal?: AbortSignal,
  ): Promise<{ changed: boolean; receipt?: InvestigationContentRef; current: RdcLifecyclePoint | null }> {
    this.assertRecovered();
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

  /** Live capture work is admitted only on a healthy lease; a quarantined one first needs capture_recover. */
  assertLiveAccess(recovers = false): void {
    if (recovers) this.assertReady();
    else this.assertRecovered();
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
    if (this.original === undefined || !this.baseline)
      return { available: false as const, reason: 'RDC_INITIAL_STATE_UNVERIFIED' };
    return { available: true as const, original: structuredClone(this.original), receipt: { ...this.baseline } };
  }

  /** Close the durable recovery record only after the final user position is observed. */
  async recordTerminalRestoration(signal?: AbortSignal): Promise<boolean> {
    if (!this.baseline || this.original === undefined) return false;
    this.assertRecovered();
    this.input.host.assertPlan();
    const observed = await this.input.host.snapshot(this.current().binding, signal);
    if (!sameRdcLifecyclePosition(observed, this.original)) return false;
    // An adopted baseline is closed under the turn that signed it, as the user's own restore does.
    const turnId = this.adoptedBaselineTurnId ?? this.input.turn.turnId;
    this.input.host.writeReceipt({
      ...this.base(randomUUID()),
      turnId,
      event: 'resolved',
      baseline: this.baseline,
      observed,
    });
    return true;
  }

  async restorationStatus(signal?: AbortSignal) {
    this.assertRecovered();
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
    this.assertRecovered();
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

  /** The admission decision a recovery would take now; read-only, nothing is signed or changed. */
  async classifyFault(signal?: AbortSignal): Promise<RdcRecoveryClassification> {
    this.assertReady();
    this.input.host.assertPlan();
    const from = this.verified();
    if (!from) throw new AppError('RDC_RECOVERY_SCOPE_INVALID', 'no verified approved capture is available.');
    return (await this.input.host.inspectRecovery(from, this.current().binding, signal)).classification;
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
    const { openExperiments } = await this.input.host.quiescent('recovery');
    guard();
    const previous = this.current();
    const facts = await this.input.host.inspectRecovery(from, previous.binding, signal);
    guard();
    this.recordStep('classified', facts);
    // A refusal acts on nothing, so it signs no intent and spends none of the turn's recovery attempts.
    if (facts.classification.decision === 'quarantined')
      throw new AppError(facts.classification.code, facts.classification.reason);
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
      await this.input.host.reopenAfterFailure(destination, previous.binding, signal, onStopped, guard, {
        classification: facts.classification,
        processes: from.native.processIdentity,
      });
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
        lostWithProcess: lostWithProcess(from, facts.classification, openExperiments),
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
      this.pendingRecovery = false;
      this.recordStep('recovered', facts);
      return { changed: true, receipt, current: to };
    } catch (error) {
      this.fail(intent, base, from, error, true);
      this.recordStep('recovery-failed', facts, error);
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
  /** One ledger fact per recovery step: the decision, the attempt it was and how it ended. */
  private recordStep(step: string, facts: RecoveryFacts, error?: unknown): void {
    const { classification } = facts;
    const code = error instanceof Error ? /^[A-Z][A-Z0-9_]{0,127}/u.exec(error.message)?.[0] : undefined;
    const errorCode = code ?? (classification.decision === 'quarantined' ? classification.code : undefined);
    (this.input.ledger ?? lifecycleLedger).record({
      kind: 'recovery_step',
      sessionId: this.input.sessionId,
      step,
      decision: classification.decision,
      reason: `attempt ${facts.attempts + 1} of ${RDC_RECOVERY_ATTEMPT_LIMIT}: ${classification.reason}`,
      ...(errorCode ? { errorCode } : {}),
    });
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
  /** Ready, and the owning lease is not waiting for capture_recover. */
  private assertRecovered(): void {
    this.assertReady();
    if (this.pendingRecovery || this.input.host.quarantinedContext())
      throw new AppError('RDC_CONTEXT_QUARANTINED', 'recover the capture with capture_recover first.');
  }
  private assertReady(): void {
    if (this.original === undefined)
      throw new AppError('RDC_INITIAL_STATE_UNVERIFIED', 'initial state was not recorded');
    if (!this.input.turn.isLive(this.input.turn.generation)) throw new AppError('RDC_TURN_NOT_ACTIVE');
  }
  private planHash(): string {
    return this.input.planHash.replace(/^sha256:/u, '');
  }
  private base(operationId: string) {
    return {
      sessionId: this.input.sessionId,
      projectId: this.input.projectId,
      turnId: this.input.turn.turnId,
      operationId,
      planUri: this.input.planUri,
      planHash: this.planHash(),
      recordedAt: Date.now(),
    };
  }
}

function lostWithProcess(
  from: RdcLifecyclePoint,
  classification: RdcRecoveryClassification,
  experiments: Array<{ experimentId: string; status: 'running' | 'polluted' }>,
): RdcLostWithProcess {
  return {
    debugHandles: { replaySessionId: from.native.replaySessionId, invalidated: 'all' },
    experiments: experiments.map((value) => ({ ...value, disposition: 'interrupted-by-infrastructure' })),
    replacementsAtLastVerified: {
      count: from.native.replacementCount,
      fingerprint: from.native.replacementFingerprint,
      rolledBack: false,
    },
    workers: classification.decision === 'rebuild' ? classification.lost.workers : [],
    newBaselineRequired: true,
  };
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
