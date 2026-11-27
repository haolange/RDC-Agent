/**
 * The closed set of admission checks. The host computes them as typed facts, the review model names them when it
 * denies or cannot decide, and the transcript shows them in the reader's language. One definition for all three.
 */
export const ADMISSION_CHECKS = [
  'authorized',
  'target-matches',
  'effects-bounded',
  'identity-current',
  'baseline-recorded',
  'source-bound',
  'rollback-available',
  'prior-reverted',
  'instances-remaining',
] as const;

export type AdmissionCheck = (typeof ADMISSION_CHECKS)[number];

/**
 * Who can make a failed check hold: the agent by supplying a fact (record a baseline, bind the source, revert the
 * previous change), or the host or user (a plan revision, an approval, a different permission mode).
 */
export type AdmissionRemedy = 'agent' | 'host-or-user';

export const ADMISSION_CHECK_REMEDY: Readonly<Record<AdmissionCheck, AdmissionRemedy>> = {
  authorized: 'host-or-user',
  'target-matches': 'host-or-user',
  'effects-bounded': 'host-or-user',
  'identity-current': 'host-or-user',
  'baseline-recorded': 'agent',
  'source-bound': 'agent',
  'rollback-available': 'host-or-user',
  'prior-reverted': 'agent',
  'instances-remaining': 'host-or-user',
};

export const PERMISSION_REVIEW_VERDICTS = ['allow', 'deny', 'undecidable'] as const;

export type PermissionReviewVerdictKind = (typeof PERMISSION_REVIEW_VERDICTS)[number];

const CHECK_SET: ReadonlySet<string> = new Set(ADMISSION_CHECKS);

export function isAdmissionCheck(value: unknown): value is AdmissionCheck {
  return typeof value === 'string' && CHECK_SET.has(value);
}

export function isPermissionReviewVerdict(value: unknown): value is PermissionReviewVerdictKind {
  return value === 'allow' || value === 'deny' || value === 'undecidable';
}
