#!/usr/bin/env node
import {
  epistemicRank,
  fail,
  pass,
  readHookContext,
  toolArgumentsOf,
  walkClaims,
} from './hook-check-lib.mjs';

const PROJECTION_KINDS = new Set(['compact', 'report', 'view']);

const context = await readHookContext();
if (context.__parseError) fail('report-contract: hook stdin is not valid JSON');

const args = toolArgumentsOf(context);
const kind = String(args.kind ?? args.projectionKind ?? '').trim();
const record = args.record && typeof args.record === 'object' ? args.record : args;
const projectionKind = String(record.projectionKind ?? args.projectionKind ?? '').trim();
const isProjection = kind === 'report' || PROJECTION_KINDS.has(projectionKind);

if (!isProjection) pass('report-contract: not a report/view/compact projection');

const violations = [];
walkClaims(record, (claim) => {
  const provenance = Array.isArray(claim.compactProvenance) ? claim.compactProvenance : [];
  if (provenance.length < 1) {
    violations.push(`${claim.claimId ?? 'claim'} missing compactProvenance (S-CLAIM-01)`);
    return;
  }
  const projected = String(claim.epistemic ?? '');
  const projectedRank = epistemicRank(projected);
  if (projectedRank < 0) return;
  let minSource = Number.POSITIVE_INFINITY;
  for (const entry of provenance) {
    const sourceStatus = String(entry?.sourceEpistemicStatus ?? '');
    const sourceRank = epistemicRank(sourceStatus);
    if (sourceRank >= 0) minSource = Math.min(minSource, sourceRank);
  }
  if (Number.isFinite(minSource) && projectedRank > minSource) {
    violations.push(`${claim.claimId ?? 'claim'} raises epistemic rank (S-CLAIM-01)`);
  }
});

if (violations.length > 0) fail(`report-contract: ${violations.join('; ')}`);
pass('report-contract: ok');
