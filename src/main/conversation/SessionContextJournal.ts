import type { AgentRole } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import { getConcreteForkBranches, normalizeBranchId } from '@shared/conversation/conversationBranchResolver';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import type { AssistantMessage, Message, ThinkingContent, ToolCall, ToolResultMessage } from '../agent-runtime/core/types';
import { storageAdapter } from '../sessions/StorageAdapter';

export interface SessionContextRoute {
  providerId: string;
  modelId: string;
  protocol: string;
}

export interface SessionContextTurnEntry {
  schemaVersion: 1;
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  branchId: string;
  agentId: AgentRole;
  route: SessionContextRoute;
  controls: ConversationTurnControls;
  status: 'complete' | 'stopped' | 'error';
  messages: Message[];
  createdAt: number;
  completedAt: number;
}

export interface SessionContextMaterialization {
  messages: Message[];
  selectedTurnCount: number;
  filteredArtifactCount: number;
  migrated: boolean;
}

const EMPTY_CONTROLS: ConversationTurnControls = {
  reasoningLevel: 'off',
  maxContextMode: false,
  fastModel: false,
};

const canonicalProtocolKey = (protocol: string | undefined): string => (
  (protocol ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
);

const isSameRoute = (left: SessionContextRoute, right: SessionContextRoute): boolean => (
  left.providerId === right.providerId
  && left.modelId === right.modelId
  && canonicalProtocolKey(left.protocol) === canonicalProtocolKey(right.protocol)
);

const isCompatibleArtifact = (block: ThinkingContent, route: SessionContextRoute): boolean => {
  const artifact = block.artifact;
  return !artifact || (
    artifact.providerId === route.providerId
    && artifact.modelId === route.modelId
    && canonicalProtocolKey(artifact.protocol) === canonicalProtocolKey(route.protocol)
  );
};

export const filterSessionContextMessageArtifacts = (
  message: Message,
  route: SessionContextRoute,
  sourceRoute: SessionContextRoute = route,
): { message: Message; filtered: number } => {
  if (message.role !== 'assistant') return { message, filtered: 0 };
  let filtered = 0;
  const content = message.content.reduce<AssistantMessage['content']>((blocks, block) => {
    if (block.type !== 'thinking') {
      blocks.push(block);
      return blocks;
    }
    const replayable = block.replayPolicy === 'provider-artifact'
      ? isSameRoute(sourceRoute, route) && isCompatibleArtifact(block, route)
      : block.replayPolicy === 'openai-reasoning-content'
        ? isSameRoute(sourceRoute, route) && Boolean(block.text)
        : false;
    if (replayable) blocks.push(block);
    else filtered += 1;
    return blocks;
  }, []);
  return { message: { ...message, content }, filtered };
};

export const canonicalizeTerminalContextMessages = (messages: Message[]): Message[] => {
  const completedToolCalls = new Set(
    messages.filter((message): message is ToolResultMessage => message.role === 'toolResult')
      .map((message) => message.toolCallId),
  );
  const result: Message[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') {
      result.push(message);
      continue;
    }
    const content = message.content.filter((block) => (
      block.type !== 'toolCall' || completedToolCalls.has((block as ToolCall).id)
    ));
    if (content.length > 0) result.push({ ...message, content });
  }
  return result;
};

export class SessionContextJournal {
  ensureMigrated(sessionId: string): boolean {
    if (storageAdapter.readSessionContextMigrationVersion(sessionId) === 1) return false;
    const existingTurnIds = new Set(
      this.readEntries(sessionId).map((entry) => entry.turnId),
    );
    const history = storageAdapter.readConversationHistory(sessionId);
    const branchState = storageAdapter.readConversationBranchState(sessionId);
    const concreteBranchIds = new Set<string>([ROOT_BRANCH_ID]);
    for (const fork of branchState?.forks ?? []) {
      for (const branch of getConcreteForkBranches(fork)) concreteBranchIds.add(branch.branchId);
    }
    const byTurn = new Map<string, ConversationMessage[]>();
    for (const message of history) {
      if (!concreteBranchIds.has(normalizeBranchId(message.branchId))) continue;
      const entries = byTurn.get(message.turnId) ?? [];
      entries.push(message);
      byTurn.set(message.turnId, entries);
    }
    for (const [turnId, messages] of byTurn) {
      if (existingTurnIds.has(turnId)) continue;
      const user = messages.find((message) => message.role === 'user');
      const assistant = messages.find((message) => message.role === 'assistant' && message.status !== 'streaming');
      if (!user || !assistant) continue;
      storageAdapter.appendSessionContextTurn(sessionId, {
        schemaVersion: 1,
        turnId,
        userMessageId: user.id,
        assistantMessageId: assistant.id,
        branchId: user.branchId ?? assistant.branchId ?? 'branch_root',
        agentId: (assistant.agentId ?? user.agentId ?? 'ask') as AgentRole,
        route: { providerId: 'synthetic', modelId: 'provider-neutral', protocol: 'provider-neutral' },
        controls: EMPTY_CONTROLS,
        status: assistant.status === 'stopped' ? 'stopped' : assistant.status === 'error' ? 'error' : 'complete',
        messages: [
          { role: 'user', content: user.content, timestamp: user.createdAt },
          ...assistant.content.trim() ? [{
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: assistant.content }],
            model: 'provider-neutral',
            provider: 'synthetic',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop' as const,
            timestamp: assistant.createdAt,
          }] : [],
        ],
        createdAt: user.createdAt,
        completedAt: assistant.updatedAt ?? assistant.createdAt,
      });
    }
    storageAdapter.writeSessionContextMigrationVersion(sessionId);
    return true;
  }

  materialize(sessionId: string, visibleTurnIds: string[], route: SessionContextRoute): SessionContextMaterialization {
    const migrated = this.ensureMigrated(sessionId);
    const entries = this.readEntries(sessionId);
    const entryByTurn = new Map(entries.map((entry) => [entry.turnId, entry]));
    const missingTurnIds = visibleTurnIds.filter((turnId) => !entryByTurn.has(turnId));
    if (missingTurnIds.length > 0) {
      throw new Error(`Session context journal is incomplete for ${missingTurnIds.length} visible turn(s).`);
    }
    let filteredArtifactCount = 0;
    const messages = visibleTurnIds.flatMap((turnId) => {
      const entry = entryByTurn.get(turnId);
      if (!entry) return [];
      return entry.messages.map((message) => {
        const filtered = filterSessionContextMessageArtifacts(message, route, entry.route);
        filteredArtifactCount += filtered.filtered;
        return filtered.message;
      });
    });
    return { messages, selectedTurnCount: visibleTurnIds.filter((id) => entryByTurn.has(id)).length, filteredArtifactCount, migrated };
  }

  append(sessionId: string, entry: SessionContextTurnEntry): void {
    const existing = this.readEntries(sessionId);
    const duplicate = existing.find((candidate) => candidate.turnId === entry.turnId);
    if (duplicate) {
      const canonicalEntry = { ...entry, messages: canonicalizeTerminalContextMessages(entry.messages) };
      if (JSON.stringify(duplicate) !== JSON.stringify(canonicalEntry)) {
        throw new Error(`Conflicting session context entry for turn ${entry.turnId}.`);
      }
      return;
    }
    storageAdapter.appendSessionContextTurn(sessionId, {
      ...entry,
      messages: canonicalizeTerminalContextMessages(entry.messages),
    });
  }

  private readEntries(sessionId: string): SessionContextTurnEntry[] {
    const entries = storageAdapter.readSessionContextJournal(sessionId);
    for (const entry of entries) {
      if (
        entry?.schemaVersion !== 1
        || !entry.turnId?.trim()
        || !entry.userMessageId?.trim()
        || !entry.assistantMessageId?.trim()
        || !entry.branchId?.trim()
        || !entry.route?.providerId?.trim()
        || !entry.route?.modelId?.trim()
        || !entry.route?.protocol?.trim()
        || !Array.isArray(entry.messages)
      ) {
        throw new Error('Session context journal contains an invalid entry.');
      }
    }
    return entries;
  }
}

export const sessionContextJournal = new SessionContextJournal();
