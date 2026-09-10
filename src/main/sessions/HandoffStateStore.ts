import * as fs from 'node:fs';
import type { HandoffContract } from '@shared/types/handoffContract';
import { assertHandoffTransition } from './handoffExecution';
import * as path from 'node:path';
import { generateEventId, nowMs } from '@shared/utils/id';
import {
  HANDOFF_CHAIN_LIMIT,
  HANDOFF_ERROR,
  isActiveHandoffLifecycle,
  type HandoffStateDocument,
  type ProfileHandoffCancelReason,
  type ProfileHandoffState,
} from '@shared/types/profileHandoff';
import {
  HANDOFF_STATE_MIGRATIONS,
  toHandoffStateDocument,
} from './handoffStateSchema';
import type { StorageHost } from './storageHost';

export interface PrepareHandoffInput {
  sourceTurnId: string;
  sourceRequestId: string;
  sourceAgentId: string;
  toAgentId: string;
  contract: HandoffContract;
  prompt: string;
  label: string;
  declaredModel: string | null;
  send: boolean;
  chainRoot: string;
  depth: number;
  /** When set, persist reuses the memory-draft id instead of minting another. */
  handoffId?: string;
  taskExecution?: ProfileHandoffState['taskExecution'];
  taskResult?: ProfileHandoffState['taskResult'];
}

function handoffConflict(detail: string): Error {
  return new Error(`${HANDOFF_ERROR.STATE_CONFLICT}: ${detail}`);
}

export class HandoffStateStore {
  /**
   * Handoff ids prepared or committed in this process. Restart hydrate treats
   * durable prepared/committed ids missing from this set as restart_degrade.
   */
  private readonly liveHandoffIds = new Set<string>();
  /** In-memory drafts reserved after bind and before persist. */
  private readonly draftReservations = new Map<string, string>();

  constructor(private readonly host: StorageHost) {}

  getHandoffStatePath(sessionId: string): string | null {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) return null;
    return path.join(location.sessionPath, 'handoff-state.json');
  }

  readDocument(sessionId: string): HandoffStateDocument | null {
    const filePath = this.getHandoffStatePath(sessionId);
    if (!filePath) return null;
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath);
      let old: unknown;
      try { old = JSON.parse(raw.toString('utf8')); }
      catch { return this.host.io.readJson(filePath, HANDOFF_STATE_MIGRATIONS); }
      if (old && typeof old === 'object' && 'schemaVersion' in old && old.schemaVersion === '1') {
        const archive = filePath + '.v1-archive';
        if (!fs.existsSync(archive)) fs.writeFileSync(archive, raw, { flag: 'wx' });
        else if (!fs.readFileSync(archive).equals(raw)) throw handoffConflict('v1 archive differs; migration stopped.');
        this.host.io.writeJsonAtomic(filePath, { ...toHandoffStateDocument(null), migrationNotice: '旧交接已原样归档，未推测执行周期；待续跑交接已停用，请按当前目标重新建立交接。' });
      }
    }
    return this.host.io.readJson(filePath, HANDOFF_STATE_MIGRATIONS);
  }

  getActive(sessionId: string): ProfileHandoffState | null {
    const active = this.readDocument(sessionId)?.active ?? null;
    return active && isActiveHandoffLifecycle(active.lifecycle) ? active : null;
  }

  isLiveThisProcess(handoffId: string): boolean {
    return this.liveHandoffIds.has(handoffId);
  }

  /** Test helper: simulate process restart without deleting durable state. */
  forgetLiveHandoffs(): void {
    this.liveHandoffIds.clear();
  }

  computeNextChain(
    sessionId: string,
    sourceAgentId: string,
    currentTurnId?: string,
  ): { chainRoot: string; depth: number } {
    const document = this.readDocument(sessionId);
    const history = document?.history ?? [];
    const lastConsumed = [...history].reverse().find((entry) => entry.lifecycle === 'consumed');
    if (
      lastConsumed
      && lastConsumed.toAgentId === sourceAgentId
      && currentTurnId
      && lastConsumed.continuationTurnId === currentTurnId
    ) {
      return { chainRoot: lastConsumed.chainRoot, depth: lastConsumed.depth + 1 };
    }
    return { chainRoot: generateEventId('handoff-root'), depth: 1 };
  }

  /**
   * Restart hydrate only. Cancels durable prepared/committed that this process
   * did not create. Never auto-sends.
   */
  hydrate(sessionId: string): ProfileHandoffState | null {
    const active = this.getActive(sessionId);
    if (!active) return null;
    if (this.liveHandoffIds.has(active.handoffId)) return active;
    return this.cancel(sessionId, 'restart_degrade');
  }

  /**
   * Memory-only prepare. Reserves the session so a second draft is ALREADY_ACTIVE.
   * Does not write durable state or mark the id live.
   */
  createPreparedDraft(sessionId: string, input: PrepareHandoffInput): ProfileHandoffState {
    this.assertCanPrepare(sessionId, input);
    const prepared = this.buildPreparedState(input);
    this.draftReservations.set(sessionId, prepared.handoffId);
    return prepared;
  }

  abandonDraft(sessionId: string, handoffId: string): void {
    if (this.draftReservations.get(sessionId) === handoffId) {
      this.draftReservations.delete(sessionId);
    }
  }

  prepare(sessionId: string, input: PrepareHandoffInput): ProfileHandoffState {
    this.assertCanPrepare(sessionId, input);
    const reserved = this.draftReservations.get(sessionId);
    if (reserved && input.handoffId && reserved !== input.handoffId) {
      throw new Error(`${HANDOFF_ERROR.ALREADY_ACTIVE}: session already has an unfinished handoff.`);
    }
    const prepared = this.buildPreparedState(input);
    this.writeDocument(sessionId, prepared, this.readDocument(sessionId)?.history ?? []);
    this.liveHandoffIds.add(prepared.handoffId);
    this.draftReservations.delete(sessionId);
    return prepared;
  }

  private assertCanPrepare(sessionId: string, input: PrepareHandoffInput): void {
    if (this.getActive(sessionId)) {
      throw new Error(`${HANDOFF_ERROR.ALREADY_ACTIVE}: session already has an unfinished handoff.`);
    }
    const reserved = this.draftReservations.get(sessionId);
    if (reserved && reserved !== input.handoffId) {
      throw new Error(`${HANDOFF_ERROR.ALREADY_ACTIVE}: session already has an unfinished handoff.`);
    }
    assertHandoffTransition(input, this.readDocument(sessionId)?.history ?? []);
    if (input.depth > HANDOFF_CHAIN_LIMIT) {
      throw new Error(`${HANDOFF_ERROR.CHAIN_LIMIT}: handoff chain exceeds ${HANDOFF_CHAIN_LIMIT}.`);
    }
  }

  private buildPreparedState(input: PrepareHandoffInput): ProfileHandoffState {
    return {
      handoffId: input.handoffId ?? generateEventId('handoff'),
      lifecycle: 'prepared',
      sourceTurnId: input.sourceTurnId,
      sourceRequestId: input.sourceRequestId,
      sourceAgentId: input.sourceAgentId,
      toAgentId: input.toAgentId,
      chainRoot: input.chainRoot,
      depth: input.depth,
      contract: structuredClone(input.contract),
      prompt: input.prompt,
      label: input.label,
      declaredModel: input.declaredModel,
      send: input.send,
      preparedAt: nowMs(),
      ...(input.taskExecution ? { taskExecution: { ...input.taskExecution } } : {}),
      ...(input.taskResult ? { taskResult: structuredClone(input.taskResult) } : {}),
    };
  }

  commit(sessionId: string, sourceTurnId: string): ProfileHandoffState {
    const active = this.getActive(sessionId);
    if (!active || active.lifecycle !== 'prepared' || active.sourceTurnId !== sourceTurnId) {
      throw handoffConflict('commit requires a prepared handoff for the source turn.');
    }
    const committed: ProfileHandoffState = {
      ...active,
      lifecycle: 'committed',
      committedAt: nowMs(),
    };
    this.writeDocument(sessionId, committed, this.readDocument(sessionId)?.history ?? []);
    this.liveHandoffIds.add(committed.handoffId);
    return committed;
  }

  consume(sessionId: string, handoffId: string, continuationTurnId?: string): ProfileHandoffState {
    const active = this.getActive(sessionId);
    if (!active || active.lifecycle !== 'committed' || active.handoffId !== handoffId) {
      throw handoffConflict('consume requires the committed handoff.');
    }
    const consumed: ProfileHandoffState = {
      ...active,
      lifecycle: 'consumed',
      consumedAt: nowMs(),
      ...(continuationTurnId ? { continuationTurnId } : {}),
    };
    const history = [...(this.readDocument(sessionId)?.history ?? []), consumed];
    this.writeDocument(sessionId, null, history);
    this.liveHandoffIds.delete(consumed.handoffId);
    return consumed;
  }

  cancel(sessionId: string, reason: ProfileHandoffCancelReason): ProfileHandoffState | null {
    const active = this.getActive(sessionId);
    if (!active) return null;
    const cancelled: ProfileHandoffState = {
      ...active,
      lifecycle: 'cancelled',
      cancelledAt: nowMs(),
      cancelReason: reason,
    };
    const history = [...(this.readDocument(sessionId)?.history ?? []), cancelled];
    this.writeDocument(sessionId, null, history);
    this.liveHandoffIds.delete(cancelled.handoffId);
    return cancelled;
  }

  private writeDocument(
    sessionId: string,
    active: ProfileHandoffState | null,
    history: readonly ProfileHandoffState[],
  ): void {
    const filePath = this.getHandoffStatePath(sessionId);
    if (!filePath) {
      throw new Error(`${HANDOFF_ERROR.STATE_CONFLICT}: session not found for handoff state: ${sessionId}`);
    }
    if (active && isActiveHandoffLifecycle(active.lifecycle)) {
      const alreadyActive = history.some((entry) => isActiveHandoffLifecycle(entry.lifecycle));
      if (alreadyActive) {
        throw handoffConflict('history must not contain another prepared/committed handoff.');
      }
    }
    this.host.io.writeJsonAtomic(filePath, toHandoffStateDocument(active, history));
  }
}
