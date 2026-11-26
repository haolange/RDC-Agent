import React from 'react';
import { useI18n } from '../../i18n';
import { CopyDiagnosticsButton } from '../../patterns/CopyDiagnostics';
import { Badge } from '../../ui/Badge';
import type { ClaimRecord, InvestigationReport } from '@shared/types/renderdocInvestigation';

const prefix = 'control.rightRail.artifacts.preview.report' as const;

/**
 * The report reads as a document: what was asked, what was found, how it was checked, where it stops and what it
 * concludes. Each claim carries one verification label. Record ids, scope pairs and settlement states are not shown;
 * the copy-diagnostics button at the end carries them.
 */
export const RightRailReportView: React.FC<{ report: InvestigationReport }> = ({ report }) => {
  const { t } = useI18n();
  const contract = report.reportContract;
  const missing = t(`${prefix}.notRecorded`);
  const text = (value: string | undefined) => value?.trim() || missing;
  const debuggerMission = report.mission === 'debugger';
  const scopes = report.claims.flatMap((claim) =>
    Object.entries(claim.scope)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => `${key}=${value}`),
  );
  const diagnostics: Array<[string, string[]]> = [
    [t(`${prefix}.evidenceIds`), report.evidenceIds],
    [t(`${prefix}.experimentIds`), report.experimentIds],
    [t(`${prefix}.artifactIds`), contract?.artifactIds ?? []],
    [t(`${prefix}.scope`), scopes],
    [t(`${prefix}.status`), contract?.status ? [contract.status] : []],
    [t(`${prefix}.candidateStatus`), contract?.candidateStatus ? [contract.candidateStatus] : []],
  ];

  return (
    <article className="investigation-report" aria-label={t(`${prefix}.title`)}>
      <ReportSection title={t(`${prefix}.goal`)}>{text(report.summary)}</ReportSection>
      <ReportSection title={t(`${prefix}.plan`)}>{text(contract?.links)}</ReportSection>
      <ReportSection title={t(debuggerMission ? `${prefix}.evidence` : `${prefix}.evidenceGeneral`)}>
        {text(contract?.evidence)}
      </ReportSection>
      <section>
        <h3>{t(debuggerMission ? `${prefix}.claims` : `${prefix}.claimsGeneral`)}</h3>
        {report.claims.length ? (
          <ul className="investigation-report-claims">
            {report.claims.map((claim) => (
              <ReportClaim key={claim.claimId} claim={claim} />
            ))}
          </ul>
        ) : (
          <p>{missing}</p>
        )}
      </section>
      <ReportSection title={t(debuggerMission ? `${prefix}.experiment` : `${prefix}.experimentGeneral`)}>
        {text(contract?.verification)}
      </ReportSection>
      <ReportSection title={t(`${prefix}.limits`)}>{text(contract?.limitations)}</ReportSection>
      <ReportSection title={t(`${prefix}.conclusion`)}>{text(contract?.conclusion)}</ReportSection>
      <CopyDiagnosticsButton
        className="investigation-report-copy-diagnostics"
        facts={diagnostics.map(([label, values]) => ({ label, value: values.join(' · ') }))}
      />
    </article>
  );
};

const ReportSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section>
    <h3>{title}</h3>
    <p>{children}</p>
  </section>
);

const ReportClaim: React.FC<{ claim: ClaimRecord }> = ({ claim }) => {
  const { t } = useI18n();
  const verdict = claim.decision ? t(`${prefix}.decision.${claim.decision.verdict}`) : '';
  return (
    <li>
      <p>{claim.statement}</p>
      <span className="investigation-report-claim-tags">
        <Badge variant="outline">{t(`${prefix}.verification.${claim.verification}`)}</Badge>
        {verdict ? <Badge variant="outline">{verdict}</Badge> : null}
      </span>
      {claim.rootCause ? (
        <div className="investigation-report-tuple">
          <strong>{t(`${prefix}.rootCause`)}</strong>
          <dl>
            {Object.entries(claim.rootCause).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`${prefix}.rootCause.${key}` as Parameters<typeof t>[0])}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </li>
  );
};
