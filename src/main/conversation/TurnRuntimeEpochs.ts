import type { ExecutionOffer } from '@shared/types/executionOffer';
import type { TaskRuntimeEpoch } from '@shared/types/taskExecution';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';
import { rdcLifecycleReceipts, type RdcLifecycleReceipt } from '../rdc/RdcLifecycleReceipts';
import type { TurnCompletionReceipt } from '../agent-runtime/agent/TurnCompletionValidator';

/** Verify the signed transition chain instead of equating the final and initial replay identities. */
export function assertTurnRuntimeEpochs(input: {
  sessionId: string | null; turnId: string; initialFingerprint: string; receipt: TurnCompletionReceipt;
  offer?: ExecutionOffer | null; read?: (sessionId: string, ref: InvestigationContentRef) => RdcLifecycleReceipt;
}): void {
  const epochs: TaskRuntimeEpoch[] = input.receipt.runtimeEpochs ?? [];
  if ((input.receipt.initialRuntimePlanFingerprint ?? input.receipt.runtimePlanFingerprint) !== input.initialFingerprint) {
    throw new Error('TURN_COMPLETION_RECEIPT_INVALID: initial runtime identity differs from preparation.');
  }
  let previous = input.initialFingerprint;
  for (const epoch of epochs) {
    if (!input.sessionId || !input.offer || epoch.previousFingerprint !== previous || epoch.runtimeFingerprint === previous) {
      throw new Error('TURN_COMPLETION_RECEIPT_INVALID: invalid runtime epoch chain.');
    }
    const read = input.read ?? ((sessionId: string, ref: InvestigationContentRef) => rdcLifecycleReceipts.read(sessionId, ref));
    const transition = read(input.sessionId, epoch.receipt);
    if (transition.event !== 'transition' || transition.sessionId !== input.sessionId || transition.turnId !== input.turnId
      || transition.planUri !== input.offer.plan.uri || transition.planHash !== input.offer.plan.hash.replace(/^sha256:/u, '')
      || transition.previousFingerprint !== previous || transition.runtimeFingerprint !== epoch.runtimeFingerprint || transition.recordedAt !== epoch.recordedAt) {
      throw new Error('TURN_COMPLETION_RECEIPT_INVALID: runtime transition does not match the approved turn.');
    }
    const intent = read(input.sessionId, transition.intent);
    if (intent.event !== 'intent' || intent.sessionId !== input.sessionId || intent.operationId !== transition.operationId || intent.turnId !== input.turnId
      || intent.projectId !== transition.projectId || intent.recordedAt > transition.recordedAt
      || intent.planHash !== transition.planHash || intent.planUri !== transition.planUri
      || JSON.stringify(intent.from) !== JSON.stringify(transition.from)
      || (intent.destination === null ? transition.to !== null : !transition.to
        || intent.destination.inputId !== transition.to.inputId || intent.destination.contentSha256 !== transition.to.contentSha256
        || intent.destination.deviceId !== transition.to.deviceId)) {
      throw new Error('TURN_COMPLETION_RECEIPT_INVALID: runtime transition lacks its signed intent.');
    }
    if (intent.recovery) {
      const from = intent.from; const to = transition.to; const observed = intent.recovery.observed;
      if (!from || !to || !intent.destination || transition.restored || from.inputId !== intent.destination.inputId
        || from.contentSha256 !== intent.destination.contentSha256 || from.deviceId !== intent.destination.deviceId
        || observed.contextId !== from.native.contextId || observed.leaseVersion !== from.native.leaseVersion
        || observed.replaySessionId !== from.native.replaySessionId || observed.captureFileId !== from.native.captureFileId
        || JSON.stringify(observed.processIdentity) !== JSON.stringify(from.native.processIdentity)
        || to.native.contextId === from.native.contextId || !transition.daemonStopped) {
        throw new Error('TURN_COMPLETION_RECEIPT_INVALID: recovery lacks same-input and process continuity evidence.');
      }
    }
    if (transition.restored && (intent.original === null ? transition.to !== null : !transition.to
      || intent.original.inputId !== transition.to.inputId || intent.original.contentSha256 !== transition.to.contentSha256
      || intent.original.deviceId !== transition.to.deviceId || intent.original.native.eventId !== transition.to.native.eventId
      || intent.original.native.replacementFingerprint !== transition.to.native.replacementFingerprint
      || intent.original.isFinalOutput !== transition.to.isFinalOutput || JSON.stringify(intent.original.target) !== JSON.stringify(transition.to.target))) {
      throw new Error('TURN_COMPLETION_RECEIPT_INVALID: restoration does not match the saved original state.');
    }
    if (transition.from && (!transition.to || transition.from.native.contextId !== transition.to.native.contextId)) {
      if (!transition.daemonStopped) throw new Error('TURN_COMPLETION_RECEIPT_INVALID: daemon stop receipt is missing.');
      const stopped = read(input.sessionId, transition.daemonStopped);
      if (stopped.event !== 'daemon-stopped' || stopped.sessionId !== input.sessionId || stopped.projectId !== transition.projectId
        || stopped.operationId !== transition.operationId || stopped.contextId !== transition.from.native.contextId
        || stopped.turnId !== input.turnId || stopped.planHash !== transition.planHash || stopped.planUri !== transition.planUri
        || stopped.recordedAt < intent.recordedAt || stopped.recordedAt > transition.recordedAt
        || JSON.stringify(stopped.intent) !== JSON.stringify(transition.intent)) {
        throw new Error('TURN_COMPLETION_RECEIPT_INVALID: daemon stop receipt does not match the transition.');
      }
    } else if (transition.from && transition.to && transition.from.native.contextId === transition.to.native.contextId
      && (JSON.stringify(transition.from.native.processIdentity) !== JSON.stringify(transition.to.native.processIdentity)
        || transition.from.native.replaySessionId === transition.to.native.replaySessionId)) {
      throw new Error('TURN_COMPLETION_RECEIPT_INVALID: same-context replay continuity is unverified.');
    }
    previous = epoch.runtimeFingerprint;
  }
  if (input.receipt.runtimePlanFingerprint !== previous) throw new Error('TURN_COMPLETION_RECEIPT_INVALID: final runtime identity differs from its signed chain.');
}
