import fs from 'fs';
import path from 'path';
import { isMissionAgentId, LEGACY_UNKNOWN_PROFILE_ID } from '@shared/types/agent';
import { readJsonl } from '@shared/utils/jsonl';
import type { RunProfileRecovery } from './runRecordSchema';

interface ConversationLike {
  runId?: string | null;
  role?: string;
  status?: string;
  agentId?: string;
  profileId?: string;
}

interface ActionLike {
  run_id?: string;
  agent_id?: string;
}

const terminalStatuses = new Set(['complete', 'error', 'stopped']);

export function recoverRunProfileId(
  sessionPath: string,
  runId: string,
  legacyMode?: unknown,
): RunProfileRecovery {
  const diagnostics: string[] = [];
  if (legacyMode !== undefined) {
    diagnostics.push(
      `RUN_V2_LEGACY_MODE_IGNORED: old mode ${JSON.stringify(legacyMode)} is diagnostic-only and never infers profile or mission.`,
    );
  }

  const conversationPath = path.join(sessionPath, 'conversation.jsonl');
  const actionPath = path.join(sessionPath, 'action_chain.jsonl');
  const messages = fs.existsSync(conversationPath)
    ? readJsonl<ConversationLike>(conversationPath).records.filter((entry) => entry.runId === runId)
    : [];
  const actions = fs.existsSync(actionPath)
    ? readJsonl<ActionLike>(actionPath).records.filter((entry) => entry.run_id === runId)
    : [];

  const terminal = messages.filter((entry) => (
    (entry.role === 'assistant' || entry.role === 'user')
    && (!entry.status || terminalStatuses.has(entry.status))
  ));
  const assistantIds = uniqueIds(terminal.filter((entry) => entry.role === 'assistant'));
  const userIds = uniqueIds(terminal.filter((entry) => entry.role === 'user'));
  const actionIds = Array.from(new Set(
    actions.map((entry) => entry.agent_id?.trim()).filter((id): id is string => Boolean(id)),
  ));

  if (assistantIds.length === 1) {
    if (assistantIds[0] !== userIds[0] && userIds.length > 0) {
      diagnostics.push(
        `RUN_V2_PROFILE_ASSISTANT_PRIORITY: terminal assistant ${assistantIds[0]} preferred over user ${userIds.join(',')}.`,
      );
    }
    return { profileId: assistantIds[0]!, diagnostics };
  }
  if (assistantIds.length > 1) {
    diagnostics.push(
      `RUN_V2_PROFILE_ASSISTANT_CONFLICT: conflicting terminal assistant ids ${assistantIds.join(',')}; using first.`,
    );
    return { profileId: assistantIds[0]!, diagnostics };
  }
  if (userIds.length === 1) {
    return { profileId: userIds[0]!, diagnostics };
  }
  if (actionIds.length === 1) {
    return { profileId: actionIds[0]!, diagnostics };
  }
  if (actionIds.length > 1) {
    diagnostics.push(
      `RUN_V2_PROFILE_ACTION_CONFLICT: conflicting action agent_id ${actionIds.join(',')}; leaving unknown.`,
    );
  }
  diagnostics.push('RUN_V2_PROFILE_UNKNOWN: no unique conversation or action-event identity.');
  return { profileId: LEGACY_UNKNOWN_PROFILE_ID, diagnostics };
}

function uniqueIds(messages: ConversationLike[]): string[] {
  return Array.from(new Set(messages.map((entry) => {
    const id = (entry.agentId || entry.profileId || '').trim();
    return id;
  }).filter(Boolean)));
}

export function isExactMissionProfile(profileId: string): boolean {
  return isMissionAgentId(profileId);
}
