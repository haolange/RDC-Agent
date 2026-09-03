#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultRepoRoot,
  isDirectInvocation,
  printCheckResult,
  runSystemDebtCheck,
} from './system-debt-ratchet.mjs';
import { assertBuiltinProfileContracts } from './builtin-profile-contracts.mjs';

const INVESTIGATION_RECORDS = [
  'WorldState',
  'EvidenceRecord',
  'ClaimRecord',
  'ExperimentRecord',
  'ChallengeRecord',
  'MissionCheckpoint',
  'InvestigationArtifactManifest',
];

export const INVESTIGATION_CONTRACT_CASES = [
  { title: 'investigation.contract.schema.namespace-fields', minAssertions: 1 },
  { title: 'investigation.contract.ready.source-hash-schema', minAssertions: 1 },
  { title: 'investigation.contract.epistemic.order', minAssertions: 1 },
  { title: 'investigation.contract.s-claim.positive-negative', minAssertions: 1 },
  { title: 'investigation.contract.s-causal.positive-negative', minAssertions: 1 },
  { title: 'investigation.contract.s-causal.ready-denied-without-experiment', minAssertions: 1 },
  { title: 'investigation.contract.skeptic.challenge-shape', minAssertions: 1 },
  { title: 'investigation.contract.checkpoint.ids-resolvable', minAssertions: 1 },
  { title: 'investigation.contract.s-rdc.positive-negative', minAssertions: 1 },
  { title: 'investigation.contract.non-invasion', minAssertions: 1 },
  { title: 'investigation.contract.rail.five-cards', minAssertions: 1 },
  { title: 'investigation.contract.analyzer.claimkind-layer', minAssertions: 1 },
  { title: 'investigation.contract.optimizer.rollback-close', minAssertions: 1 },
  { title: 'investigation.contract.txn.atomic-recover', minAssertions: 1 },
  { title: 'investigation.contract.txn.degraded-not-empty', minAssertions: 1 },
];
export const INVESTIGATION_CONTRACT_CASE_IDS = INVESTIGATION_CONTRACT_CASES.map((entry) => entry.title);

const BUILTIN_PROFILES = ['general', 'debugger', 'analyzer', 'optimizer'];

export const INVESTIGATION_RULE_REGISTRY = [
  {
    id: 'investigation.missing.types.renderdocInvestigation',
    kind: 'missing',
    file: 'src/shared/types/renderdocInvestigation.ts',
    pattern: "rdc\\.investigation\\.v1",
    probe: 'source-pattern',
    note: 'vertical schema namespace lives in src/shared/types/renderdocInvestigation.ts',
  },
  ...INVESTIGATION_RECORDS.map((record) => ({
    id: `investigation.missing.schema.${record}`,
    kind: 'missing',
    file: 'src/shared/types/renderdocInvestigation.ts',
    pattern: record === 'ClaimRecord'
      ? 'export (?:interface|type) ClaimRecord[\\s\\S]*claimId[\\s\\S]*experimentId'
      : record === 'ExperimentRecord'
        ? 'export (?:interface|type) ExperimentRecord[\\s\\S]*experimentId'
        : record === 'ChallengeRecord'
          ? 'export (?:interface|type) ChallengeRecord[\\s\\S]*challengeId'
          : record === 'InvestigationArtifactManifest'
            ? 'export (?:interface|type) InvestigationArtifactManifest[\\s\\S]*artifactId'
            : `export (?:interface|type) ${record}`,
    probe: 'source-pattern',
    note: `rdc.investigation.v1 must define ${record}`,
  })),
  {
    id: 'investigation.missing.dir.main',
    kind: 'missing',
    file: 'src/main/investigation',
    pattern: '',
    probe: 'dir-exists',
    note: 'main-owned investigation module directory',
  },
  {
    id: 'investigation.missing.session.artifacts-card',
    kind: 'missing',
    file: 'src/renderer/features/debugger/ControlPanel/TraceRightPanel.tsx',
    pattern: 'id="artifacts"',
    probe: 'source-pattern',
    note: 'Session rail target five cards include Artifacts',
  },
  ...BUILTIN_PROFILES.map((profile) => ({
    id: `investigation.missing.builtin.${profile}`,
    kind: 'missing',
    file: `resources/agent-runtime/agents/${profile}.agent.md`,
    pattern: 'target:\\s*rdc-agent',
    probe: 'source-pattern',
    note: `four builtin profiles include ${profile} (general + three Missions)`,
  })),
  {
    id: 'investigation.missing.contract.suite',
    kind: 'missing',
    file: 'src/main/testing/investigationSystemContract.test.ts',
    pattern: INVESTIGATION_CONTRACT_CASE_IDS.join('|'),
    probe: 'contract-suite',
    note: 'executable Investigation contract suite: schema, ready, epistemic, S-CLAIM/S-CAUSAL/S-RDC, skeptic challenge, checkpoint refs, non-invasion, five cards, analyzer claimKind layer, optimizer rollback close, transactional write recover, degraded-not-empty',
    requiredCases: INVESTIGATION_CONTRACT_CASES,
    minTests: INVESTIGATION_CONTRACT_CASES.length,
    minAssertions: INVESTIGATION_CONTRACT_CASES.length,
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.seed',
    kind: 'forbidden',
    file: 'src/main/settings/AgentManifestService.ts',
    pattern: "const createSeedDefinition[\\s\\S]*agentId === 'ask'[\\s\\S]*agentId === 'plan'[\\s\\S]*agentId === 'edit'",
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit user seed writer is current debt',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.top-level',
    kind: 'forbidden',
    file: 'src/shared/types/agent.ts',
    pattern: "TOP_LEVEL_AGENT_IDS: AgentId\\[\\] = \\['ask', 'plan', 'edit'",
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit remain top-level agent ids',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.default',
    kind: 'forbidden',
    file: 'src/shared/types/agent.ts',
    pattern: "DEFAULT_MODEL_ROUTING: Record<AgentId[\\s\\S]*ask:",
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit default model routing is current debt',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.fallback',
    kind: 'forbidden',
    file: 'src/main/workflow/debugger/AgentSlotRegistry.ts',
    pattern: "fallbackAgentId[\\s\\S]*'edit'",
    probe: 'source-pattern',
    note: 'unknown agents still fall back to Edit',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.app-mode',
    kind: 'forbidden',
    file: 'src/shared/types/session.ts',
    pattern: "export type AppMode = 'ask' \\| 'edit'",
    probe: 'source-pattern',
    note: 'AppMode still includes Ask/Edit',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.category',
    kind: 'forbidden',
    file: 'src/shared/constants/agents.ts',
    pattern: "AGENT_CATEGORIES[\\s\\S]*ask: 'orchestrator'[\\s\\S]*plan: 'orchestrator'[\\s\\S]*edit: 'orchestrator'",
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit category map is current debt',
  },
  {
    id: 'investigation.forbidden.ask-plan-edit.write-scopes',
    kind: 'forbidden',
    file: 'src/shared/constants/agents.ts',
    pattern: "AGENT_WRITE_SCOPES[\\s\\S]*ask: \\[\\][\\s\\S]*plan:",
    probe: 'source-pattern',
    note: 'Ask/Plan/Edit writeScopes map is current debt',
  },
  {
    id: 'investigation.forbidden.agent-hooks',
    kind: 'forbidden',
    file: 'src/main/agent-runtime/agent/AgentHooks.ts',
    pattern: 'export class AgentHooks',
    probe: 'source-pattern',
    note: 'second hook surface AgentHooks vs HookEngine',
  },
  {
    id: 'investigation.forbidden.background-task-runner',
    kind: 'forbidden',
    file: 'src/main/agent-runtime/scheduler/BackgroundTaskRunner.ts',
    pattern: 'export class BackgroundTaskRunner',
    probe: 'source-pattern',
    note: 'BackgroundTaskRunner is current debt',
  },
  {
    id: 'investigation.forbidden.harness-task',
    kind: 'forbidden',
    file: 'src/shared/types/harness.ts',
    pattern: 'export interface HarnessTask',
    probe: 'source-pattern',
    note: 'HarnessTask remains; do not confuse with ArtifactRecord',
  },
  {
    id: 'investigation.forbidden.task-board',
    kind: 'forbidden',
    file: 'src/main/workflow/debugger/TaskBoard.ts',
    pattern: 'export class TaskBoard',
    probe: 'source-pattern',
    note: 'TaskBoard is current debt',
  },
  {
    id: 'investigation.forbidden.run-capsule',
    kind: 'forbidden',
    file: 'src/shared/types/harness.ts',
    pattern: 'export interface RunCapsule',
    probe: 'source-pattern',
    note: 'RunCapsule is current debt',
  },
  {
    id: 'investigation.forbidden.harness-tasks-field',
    kind: 'forbidden',
    file: 'src/shared/types/workflow.ts',
    pattern: 'harnessTasks\\?:',
    probe: 'source-pattern',
    note: 'workflow harnessTasks field is current debt',
  },
  {
    id: 'investigation.forbidden.context-service',
    kind: 'forbidden',
    file: 'src/main/captures/ContextService.ts',
    pattern: 'export class ContextService',
    probe: 'source-pattern',
    note: 'captures ContextService is current debt',
  },
  {
    id: 'investigation.forbidden.evidence-ledger',
    kind: 'forbidden',
    file: 'src/main/reports/EvidenceLedger.ts',
    pattern: 'export class EvidenceLedger',
    probe: 'source-pattern',
    note: 'EvidenceLedger is current debt; not ArtifactRecord',
  },
  {
    id: 'investigation.forbidden.report-bundle',
    kind: 'forbidden',
    file: 'src/main/reports/ReportBundleService.ts',
    pattern: 'export class ReportBundleService',
    probe: 'source-pattern',
    note: 'ReportBundleService is current debt',
  },
  {
    id: 'investigation.forbidden.fixed-stages',
    kind: 'forbidden',
    file: 'src/main/agent-trace/manifests/profileManifest.ts',
    pattern: 'const BASELINE_PHASES[\\s\\S]*const PLAN_PHASES',
    probe: 'source-pattern',
    note: 'fixed Debugger/Plan harness stages are current debt',
  },
  {
    id: 'investigation.forbidden.session-evidence.schema',
    kind: 'forbidden',
    file: 'src/main/sessions/storageSchema.ts',
    pattern: 'SESSION_EVIDENCE_MIGRATIONS',
    probe: 'source-pattern',
    note: 'session_evidence schema is current debt',
  },
  {
    id: 'investigation.forbidden.session-evidence.write',
    kind: 'forbidden',
    file: 'src/main/sessions/SessionRecordStore.ts',
    pattern: 'session_evidence\\.yaml',
    probe: 'source-pattern',
    note: 'session_evidence write path is current debt',
  },
  {
    id: 'investigation.forbidden.use-agent-handoff-actions',
    kind: 'forbidden',
    file: 'src/renderer/features/debugger/AgentChat/useAgentHandoffActions.ts',
    pattern: 'export function useAgentHandoffActions',
    probe: 'source-pattern',
    note: 'renderer useAgentHandoffActions is current debt',
  },
  {
    id: 'investigation.forbidden.session.four-card',
    kind: 'forbidden',
    file: 'src/renderer/features/debugger/ControlPanel/TraceRightPanel.tsx',
    pattern: 'id="progress"[\\s\\S]*id="outputs"[\\s\\S]*id="context"[\\s\\S]*id="capture"',
    unlessPattern: 'id="artifacts"',
    probe: 'source-pattern',
    note: 'current four-card Session rail relative to target five cards',
  },
  {
    id: 'investigation.missing.txn.protocol',
    kind: 'missing',
    file: 'src/main/investigation/investigationTxn.ts',
    pattern: 'commitInvestigationTxn[\\s\\S]*recoverInvestigationTxn[\\s\\S]*INVESTIGATION_TXN_COMMIT',
    probe: 'source-pattern',
    note: 'journal / temp-set / commit marker / atomic replace live in investigationTxn',
  },
  {
    id: 'investigation.missing.service.txn',
    kind: 'missing',
    file: 'src/main/investigation/InvestigationArtifactService.ts',
    pattern: 'commitInvestigationTxn[\\s\\S]*recoverInvestigationTxn',
    probe: 'source-pattern',
    note: 'InvestigationArtifactService must commit and recover through investigationTxn',
  },
  {
    id: 'investigation.forbidden.non-txn-write-chain',
    kind: 'forbidden',
    file: 'src/main/investigation',
    pattern: 'this\\.writeArtifact\\([\\s\\S]{0,400}this\\.writeArtifact\\(',
    probe: 'walk-pattern',
    note: 'sequential writeArtifact chains are forbidden; use investigationTxn',
  },
  {
    id: 'investigation.forbidden.service.direct-write',
    kind: 'forbidden',
    file: 'src/main/investigation/InvestigationArtifactService.ts',
    pattern: 'this\\.writeArtifact\\(|this\\.upsertIndex\\(',
    probe: 'source-pattern',
    note: 'service must not write artifacts outside investigationTxn',
  },
  {
    id: 'investigation.forbidden.evidence-ledger.anywhere',
    kind: 'forbidden',
    file: 'src',
    pattern: 'export class EvidenceLedger',
    probe: 'walk-pattern',
    note: 'EvidenceLedger resurrection is hard-forbidden',
  },
  {
    id: 'investigation.forbidden.harness-task.anywhere',
    kind: 'forbidden',
    file: 'src',
    pattern: 'export interface HarnessTask',
    probe: 'walk-pattern',
    note: 'HarnessTask resurrection is hard-forbidden',
  },
  {
    id: 'investigation.forbidden.session-evidence.anywhere',
    kind: 'forbidden',
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
  return runSystemDebtCheck({
    name: 'investigation-system',
    repoRoot,
    registry: INVESTIGATION_RULE_REGISTRY,
    debtRelativePath: 'scripts/fidelity/investigation-system-debt.json',
    argv: overrides.argv || process.argv.slice(2),
    env: overrides.env || process.env,
    ...overrides,
  });
}

if (isDirectInvocation(import.meta.url)) {
  const result = runInvestigationSystemCheck();
  process.exit(printCheckResult('investigation-system', result));
}
