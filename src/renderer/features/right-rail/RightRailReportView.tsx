import type { ClaimRecord, InvestigationReport } from '@shared/types/renderdocInvestigation';
import { useI18n } from '../../i18n';

const prefix = 'control.rightRail.artifacts.preview.report' as const;

export const RightRailReportView: React.FC<{ report: InvestigationReport }> = ({ report }) => {
  const { t } = useI18n();
  const contract = report.reportContract;
  const missing = t(`${prefix}.notRecorded`);
  const text = (value: string | undefined) => value?.trim() || missing;
  const debuggerMission = report.mission === 'debugger';

  return (
    <article className="investigation-report" aria-label={t(`${prefix}.title`)}>
      <section>
        <h3>{t(`${prefix}.goal`)}</h3>
        <p>{text(report.summary)}</p>
        <p className="investigation-report-meta">{t(`${prefix}.mission`)}: {t(`control.rightRail.artifacts.mission.${report.mission}`)}</p>
      </section>
      <section>
        <h3>{t(`${prefix}.plan`)}</h3>
        <p>{text(contract?.links)}</p>
        <p className="investigation-report-note">{t(`${prefix}.timelineNotEmbedded`)}</p>
      </section>
      <section>
        <h3>{t(debuggerMission ? `${prefix}.evidence` : `${prefix}.evidenceGeneral`)}</h3>
        <p>{text(contract?.evidence)}</p>
        <RecordIds label={t(`${prefix}.evidenceIds`)} ids={report.evidenceIds} missing={missing} />
      </section>
      <section>
        <h3>{t(debuggerMission ? `${prefix}.claims` : `${prefix}.claimsGeneral`)}</h3>
        {report.claims.length ? (
          <ul className="investigation-report-claims">
            {report.claims.map((claim) => <ReportClaim key={claim.claimId} claim={claim} />)}
          </ul>
        ) : <p>{missing}</p>}
        <p className="investigation-report-note">{t(debuggerMission ? `${prefix}.firstBadAndRootCauseSource` : `${prefix}.claimSource`)}</p>
      </section>
      <section>
        <h3>{t(debuggerMission ? `${prefix}.experiment` : `${prefix}.experimentGeneral`)}</h3>
        <p>{text(contract?.verification)}</p>
        <RecordIds label={t(`${prefix}.experimentIds`)} ids={report.experimentIds} missing={missing} />
      </section>
      <section>
        <h3>{t(`${prefix}.limits`)}</h3>
        <p>{text(contract?.limitations)}</p>
        <p className="investigation-report-note">{t(`${prefix}.challengeSource`)}</p>
      </section>
      <section>
        <h3>{t(`${prefix}.conclusion`)}</h3>
        <p>{text(contract?.conclusion)}</p>
        <p className="investigation-report-meta">{t(`${prefix}.status`)}: {text(contract?.status)}</p>
        <p className="investigation-report-meta">{t(`${prefix}.candidateStatus`)}: {contract?.candidateStatus ?? missing}</p>
        <RecordIds label={t(`${prefix}.artifactIds`)} ids={contract?.artifactIds ?? []} missing={missing} />
      </section>
    </article>
  );
};

const ReportClaim: React.FC<{ claim: ClaimRecord }> = ({ claim }) => {
  const { t } = useI18n();
  const scope = Object.entries(claim.scope).filter(([, value]) => Boolean(value));
  return (
    <li>
      <p>{claim.statement}</p>
      <p className="investigation-report-meta">
        {claim.claimKind} · {claim.epistemic} · {claim.verification}
        {claim.decision ? ` · ${claim.decision.verdict}` : ''}
      </p>
      {scope.length ? <p className="investigation-report-meta">
        {t(`${prefix}.scope`)}: {scope.map(([key, value]) => `${key}=${value}`).join(' · ')}
      </p> : null}
      {claim.rootCause ? (
        <div className="investigation-report-tuple">
          <strong>{t(`${prefix}.rootCause`)}</strong>
          <dl>{Object.entries(claim.rootCause).map(([key, value]) => (
            <div key={key}><dt>{t(`${prefix}.rootCause.${key}` as Parameters<typeof t>[0])}</dt><dd>{value}</dd></div>
          ))}</dl>
        </div>
      ) : null}
    </li>
  );
};

const RecordIds: React.FC<{ label: string; ids: string[]; missing: string }> = ({ label, ids, missing }) => (
  <div className="investigation-report-index">
    <strong>{label}</strong>
    {ids.length ? <ul>{ids.map((id) => <li key={id}>{id}</li>)}</ul> : <span>{missing}</span>}
  </div>
);
