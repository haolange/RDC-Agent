import { createHash } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { AdmissionCheck } from '@shared/constants/admissionChecks';
import type { AgentAccessCeiling } from '@shared/types/agentManifest';
import type { ToolCall } from '@shared/types/tool';
import type { AgentTool, ToolExecutionContext } from '../agent/AgentTool';
import type { AgentPermissionDecision } from './AgentPermissionPolicy';
import type { PermissionReviewVerdict } from './PermissionReviewRuntime';
import type { InvestigationPlanContract } from '../../sessions/run/investigationPlanContract';

/**
 * Admission: a pending action under auto-review is decided by host-verified facts first. The review model only sees
 * what those facts cannot settle. Domain adapters compute the facts; this module owns the order of decision.
 */
export type AdmissionFactState = 'holds' | 'fails' | 'unavailable';

export interface AdmissionFact {
  check: AdmissionCheck;
  state: AdmissionFactState;
  /** One plain sentence on what the host verified, for the review model and the audit trail. */
  basis: string;
}

/** `covered`: an approved authorization names this operation, so all facts holding admits it. */
export interface AdmissionAssessment {
  coverage: 'covered' | 'uncovered';
  facts: AdmissionFact[];
}

/** What the approved plan of this execution froze for admission: when it was approved and its contract. */
export interface ApprovedAdmissionScope {
  approvedAt: number;
  contract: InvestigationPlanContract | null;
}

/** The turn an action belongs to: identity, the approved plan, and the verified entry position on demand. */
export interface AdmissionTurn {
  sessionId: string;
  projectId: string | null;
  turnId: string;
  agentId: string;
  accessCeiling: AgentAccessCeiling;
  approved: ApprovedAdmissionScope | null;
  /** The signed entry position of this turn's capture; throws when the record does not match its owner. */
  captureBaseline: () => { available: true } | { available: false; reason: string };
}

export interface AdmissionRequest {
  decision: AgentPermissionDecision;
  toolCall: ToolCall;
  tool: AgentTool;
  executionContext?: ToolExecutionContext;
}

/** A domain adapter answers for the operations it recognises and returns null for everything else. */
export type AdmissionAdapter = (request: AdmissionRequest, turn: AdmissionTurn) => AdmissionAssessment | null;

const adapters: AdmissionAdapter[] = [];

/** Domain modules register their adapters at startup, as the RDC module registers its shell baseline. */
export function registerAdmissionAdapter(adapter: AdmissionAdapter): void {
  if (!adapters.includes(adapter)) adapters.push(adapter);
}

export type AdmissionRoute =
  { route: 'rule'; verdict: PermissionReviewVerdict } | { route: 'model'; facts: readonly AdmissionFact[] };

const ruleVerdict = (verdict: PermissionReviewVerdict): AdmissionRoute => ({ route: 'rule', verdict });

/**
 * The order of decision. Without an adapter a low-risk action is admitted by rule and anything else goes to the model.
 * With one, a failing fact refuses, a covered action whose facts all hold is admitted, and the rest goes to the model
 * with the facts attached.
 */
export function decideAdmission(
  assessment: AdmissionAssessment | null,
  risk: AgentPermissionDecision['risk'],
  reason: string,
): AdmissionRoute {
  if (!assessment)
    return risk === 'low'
      ? ruleVerdict({ verdict: 'allow', failedChecks: [], reason: `RULE_APPROVED: ${reason}` })
      : { route: 'model', facts: [] };
  const failing = assessment.facts.filter((fact) => fact.state === 'fails');
  if (failing.length)
    return ruleVerdict({
      verdict: 'deny',
      failedChecks: [...new Set(failing.map((fact) => fact.check))],
      reason: failing.map((fact) => fact.basis).join(' '),
    });
  if (assessment.coverage === 'covered' && assessment.facts.every((fact) => fact.state === 'holds'))
    return ruleVerdict({
      verdict: 'allow',
      failedChecks: [],
      reason: 'The approved plan covers this action and every host check holds.',
    });
  return { route: 'model', facts: assessment.facts };
}

interface SettledRefusal {
  factsFingerprint: string;
  verdict: PermissionReviewVerdict;
  terminal: boolean;
}

/**
 * One turn's admission. It remembers each refused action so that the same action with unchanged facts is refused
 * again without sampling the model; a refusal by the user is final for the turn. Memory only, never persisted.
 */
export class TurnAdmission {
  private readonly refusals = new Map<string, SettledRefusal>();

  constructor(private readonly turn: AdmissionTurn) {}

  assess(request: AdmissionRequest, argumentsSha256: string): { route: AdmissionRoute; settle: AdmissionSettle } {
    const key = `${request.toolCall.name}:${argumentsSha256}`;
    let assessment: AdmissionAssessment | null = null;
    try {
      for (const adapter of adapters) {
        assessment = adapter(request, this.turn);
        if (assessment) break;
      }
    } catch (error) {
      // A fact the host cannot verify for an action it recognises refuses the action; it is never guessed.
      if (!(error instanceof AppError)) throw error;
      assessment = {
        coverage: 'uncovered',
        facts: [{ check: 'identity-current', state: 'fails', basis: error.message }],
      };
    }
    const factsFingerprint = fingerprint(assessment);
    const previous = this.refusals.get(key);
    const route =
      previous && (previous.terminal || previous.factsFingerprint === factsFingerprint)
        ? ruleVerdict({
            ...previous.verdict,
            reason: `Refused earlier in this turn with the same facts. ${previous.verdict.reason}`,
          })
        : decideAdmission(assessment, request.decision.risk, request.decision.reason ?? 'Review required');
    return {
      route,
      settle: (verdict, options) => {
        if (verdict.verdict === 'allow') this.refusals.delete(key);
        else this.refusals.set(key, { factsFingerprint, verdict, terminal: options?.byUser === true });
      },
    };
  }
}

/** Records how the action settled; errors are not verdicts and are not remembered. */
export type AdmissionSettle = (verdict: PermissionReviewVerdict, options?: { byUser?: boolean }) => void;

function fingerprint(assessment: AdmissionAssessment | null): string {
  const states = assessment ? assessment.facts.map((fact) => [fact.check, fact.state]) : [];
  return createHash('sha256')
    .update(JSON.stringify([assessment?.coverage ?? null, states]))
    .digest('hex');
}
