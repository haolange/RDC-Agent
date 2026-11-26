#!/usr/bin/env node
import {
  defaultRepoRoot,
  isDirectInvocation,
  printForbiddenCheck,
  runForbiddenCheck,
} from './lib/forbiddenSourceRules.mjs';
import { assertBuiltinProfileContracts } from './builtin-profile-contracts.mjs';
import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_RULES = [
  {
    id: 'investigation.forbidden.ask-plan-edit.seed',
    file: 'src/main/settings/agent-manifests/AgentManifestService.ts',
    pattern:
      "const createSeedDefinition[\\s\\S]*agentId === 'ask'[\\s\\S]*agentId === 'plan'[\\s\\S]*agentId === 'edit'",
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit user seed writer is current debt',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.top-level',
    file: 'src/shared/types/agent.ts',
    pattern: "TOP_LEVEL_AGENT_IDS: AgentId\\[\\] = \\['ask', 'plan', 'edit'",
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit remain top-level agent ids',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.default',
    file: 'src/shared/types/agent.ts',
    pattern: 'DEFAULT_MODEL_ROUTING: Record<AgentId[\\s\\S]*ask:',
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit default model routing is current debt',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.fallback',
    file: 'src/main/agent-runtime/orchestration/AgentSlotRegistry.ts',
    pattern: "fallbackAgentId[\\s\\S]*'edit'",
    probe: 'source-pattern',
    note: 'unknown agents still fall back to Edit',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.app-mode',
    file: 'src/shared/types/session.ts',
    pattern: "export type AppMode = 'ask' \\| 'edit'",
    probe: 'source-pattern',
    note: 'AppMode still includes Ask/Edit',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.category',
    file: 'src/shared/constants/agents.ts',
    pattern: "AGENT_CATEGORIES[\\s\\S]*ask: 'orchestrator'[\\s\\S]*plan: 'orchestrator'[\\s\\S]*edit: 'orchestrator'",
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit category map is current debt',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.write-scopes',
    file: 'src/shared/constants/agents.ts',
    pattern: 'AGENT_WRITE_SCOPES[\\s\\S]*ask: \\[\\][\\s\\S]*plan:',
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit writeScopes map is current debt',
  },
  {
    id: 'investigation.forbidden.agent-hooks',
    file: 'src/main/agent-runtime/agent/AgentHooks.ts',
    pattern: 'export class AgentHooks',
    probe: 'source-pattern',
    note: 'second hook surface AgentHooks vs HookEngine',
  },
  {
    id: 'investigation.forbidden.background-task-runner',
    file: 'src/main/agent-runtime/scheduler/BackgroundTaskRunner.ts',
    pattern: 'export class BackgroundTaskRunner',
    probe: 'source-pattern',
    note: 'BackgroundTaskRunner is current debt',
  },
  {
    id: 'investigation.forbidden.harness-task',
    file: 'src/main/reports/artifactRecord.ts',
    pattern: 'export interface HarnessTask',
    probe: 'source-pattern',
    note: 'HarnessTask remains; do not confuse with ArtifactRecord',
  },
  {
    id: 'investigation.forbidden.task-board',
    file: 'src/main/agent-runtime/orchestration/TaskBoard.ts',
    pattern: 'export class TaskBoard',
    probe: 'source-pattern',
    note: 'TaskBoard is current debt',
  },
  {
    id: 'investigation.forbidden.run-capsule',
    file: 'src/main/reports/artifactRecord.ts',
    pattern: 'export interface RunCapsule',
    probe: 'source-pattern',
    note: 'RunCapsule is current debt',
  },
  {
    id: 'investigation.forbidden.harness-tasks-field',
    file: 'src/shared/types/workflow.ts',
    pattern: 'harnessTasks\\?:',
    probe: 'source-pattern',
    note: 'workflow harnessTasks field is current debt',
  },
  {
    id: 'investigation.forbidden.context-service',
    file: 'src/main/captures/ContextService.ts',
    pattern: 'export class ContextService',
    probe: 'source-pattern',
    note: 'captures ContextService is current debt',
  },
  {
    id: 'investigation.forbidden.evidence-ledger',
    file: 'src/main/reports/EvidenceLedger.ts',
    pattern: 'export class EvidenceLedger',
    probe: 'source-pattern',
    note: 'EvidenceLedger is current debt; not ArtifactRecord',
  },
  {
    id: 'investigation.forbidden.report-bundle',
    file: 'src/main/reports/ReportBundleService.ts',
    pattern: 'export class ReportBundleService',
    probe: 'source-pattern',
    note: 'ReportBundleService is current debt',
  },
  {
    id: 'investigation.forbidden.session-evidence.schema',
    file: 'src/main/sessions/store/storageSchema.ts',
    pattern: 'SESSION_EVIDENCE_MIGRATIONS',
    probe: 'source-pattern',
    note: 'session_evidence schema is current debt',
  },
  {
    id: 'investigation.forbidden.session-evidence.write',
    file: 'src/main/sessions/store/SessionRecordStore.ts',
    pattern: 'session_evidence\\.yaml',
    probe: 'source-pattern',
    note: 'session_evidence write path is current debt',
  },
  {
    id: 'investigation.forbidden.use-agent-handoff-actions',
    file: 'src/renderer/features/transcript/useAgentHandoffActions.ts',
    pattern: 'export function useAgentHandoffActions',
    probe: 'source-pattern',
    note: 'renderer useAgentHandoffActions is current debt',
  },
  {
    id: 'investigation.forbidden.session.four-card',
    file: 'src/renderer/features/right-rail/SessionRightRail.tsx',
    pattern: 'id="tasks"[\\s\\S]*id="outputs"[\\s\\S]*id="context"[\\s\\S]*id="capture"',
    unlessPattern: 'id="artifacts"',
    probe: 'source-pattern',
    note: 'current four-card Session rail relative to target five cards',
  },
  {
    id: 'investigation.forbidden.non-txn-write-chain',
    file: 'src/main/investigation',
    pattern: 'this\\.writeArtifact\\([\\s\\S]{0,400}this\\.writeArtifact\\(',
    probe: 'walk-pattern',
    note: 'sequential writeArtifact chains are forbidden; use investigationTxn',
  },
  {
    id: 'investigation.forbidden.service.direct-write',
    file: 'src/main/investigation/InvestigationArtifactService.ts',
    pattern: 'this\\.writeArtifact\\(|this\\.upsertIndex\\(',
    probe: 'source-pattern',
    note: 'service must not write artifacts outside investigationTxn',
  },
  {
    id: 'investigation.forbidden.evidence-ledger.anywhere',
    file: 'src',
    pattern: 'export class EvidenceLedger',
    probe: 'walk-pattern',
    note: 'EvidenceLedger resurrection is hard-forbidden',
  },
  {
    id: 'investigation.forbidden.harness-task.anywhere',
    file: 'src',
    pattern: 'export interface HarnessTask',
    probe: 'walk-pattern',
    note: 'HarnessTask resurrection is hard-forbidden',
  },
  {
    id: 'investigation.forbidden.session-evidence.anywhere',
    file: 'src',
    pattern: 'session_evidence\\.yaml|SESSION_EVIDENCE_MIGRATIONS',
    probe: 'walk-pattern',
    note: 'session_evidence resurrection is hard-forbidden',
  },
];

export function runInvestigationSystemCheck(overrides = {}) {
  const repoRoot = overrides.repoRoot || defaultRepoRoot();
  if (fs.existsSync(path.join(repoRoot, 'resources', 'agent-runtime', 'agents'))) {
    assertBuiltinProfileContracts(repoRoot);
  }
  // Hard-forbidden structures are shared with check:knowledge-system, which reports them once.
  return runForbiddenCheck({ name: 'investigation-system', repoRoot, rules: FORBIDDEN_RULES, hardForbids: false });
}

if (isDirectInvocation(import.meta.url)) {
  process.exit(printForbiddenCheck(runInvestigationSystemCheck()));
}
