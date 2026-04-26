import { generateEventId, nowIso } from '@shared/utils/id';
import type {
  AgentResultCard,
  ContextPacket,
  PlanContract,
  RunCapsule,
} from '@shared/types/harness';
import { artifactStore } from './ArtifactStore';
import { evidenceLedger } from './EvidenceLedger';
import { taskBoard } from './TaskBoard';
import { runScopedStore } from './RunScopedStore';

const PLAN_PATH = 'plan_contract.json';
const CONTEXT_PACKETS_PATH = 'context_packets.jsonl';
const RESULT_CARDS_PATH = 'agent_result_cards.jsonl';
const CAPSULE_PATH = 'run_capsule.json';

export class ContextService {
  readPlanContract(sessionId: string, runId: string): PlanContract | null {
    return runScopedStore.readJson<PlanContract | null>(sessionId, runId, PLAN_PATH, null);
  }

  writePlanContract(sessionId: string, runId: string, contract: PlanContract): PlanContract {
    this.assertRunBinding(sessionId, runId, contract);
    const nextContract: PlanContract = {
      ...contract,
      updatedAt: nowIso(),
    };
    runScopedStore.writeJson(sessionId, runId, PLAN_PATH, nextContract);
    return nextContract;
  }

  appendContextPacket(sessionId: string, runId: string, packet: ContextPacket): ContextPacket {
    this.assertRunBinding(sessionId, runId, packet);
    const nextPacket: ContextPacket = {
      ...packet,
      packetId: packet.packetId || generateEventId('context-packet'),
      createdAt: packet.createdAt || nowIso(),
    };
    runScopedStore.appendJsonl(sessionId, runId, CONTEXT_PACKETS_PATH, nextPacket);
    return nextPacket;
  }

  listContextPackets(sessionId: string, runId: string): ContextPacket[] {
    return runScopedStore.readJsonl<ContextPacket>(sessionId, runId, CONTEXT_PACKETS_PATH);
  }

  appendAgentResultCard(sessionId: string, runId: string, card: AgentResultCard): AgentResultCard {
    this.assertRunBinding(sessionId, runId, card);
    const now = nowIso();
    const nextCard: AgentResultCard = {
      ...card,
      cardId: card.cardId || generateEventId('agent-result-card'),
      createdAt: card.createdAt || now,
      updatedAt: now,
    };
    runScopedStore.appendJsonl(sessionId, runId, RESULT_CARDS_PATH, nextCard);
    return nextCard;
  }

  listAgentResultCards(sessionId: string, runId: string): AgentResultCard[] {
    return runScopedStore.readJsonl<AgentResultCard>(sessionId, runId, RESULT_CARDS_PATH);
  }

  buildRunCapsule(sessionId: string, runId: string): RunCapsule {
    const now = nowIso();
    return {
      schemaVersion: '1',
      capsuleId: generateEventId('run-capsule'),
      runId,
      sessionId,
      planContract: this.readPlanContract(sessionId, runId) ?? undefined,
      contextPackets: this.listContextPackets(sessionId, runId),
      tasks: taskBoard.listTasks(sessionId, runId),
      evidence: evidenceLedger.listEvidence(sessionId, runId),
      artifacts: artifactStore.list(sessionId, runId),
      verificationResults: evidenceLedger.listVerificationResults(sessionId, runId),
      agentResultCards: this.listAgentResultCards(sessionId, runId),
      createdAt: now,
      updatedAt: now,
    };
  }

  writeRunCapsule(sessionId: string, runId: string): RunCapsule {
    const capsule = this.buildRunCapsule(sessionId, runId);
    runScopedStore.writeJson(sessionId, runId, CAPSULE_PATH, capsule);
    return capsule;
  }

  private assertRunBinding(
    sessionId: string,
    runId: string,
    value: { sessionId: string; runId: string },
  ): void {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}

export const contextService = new ContextService();
