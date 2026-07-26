import React from 'react';
import { useI18n } from '../../../i18n';

export interface SkillEntry {
  id: string;
  label: string;
  description: string;
}

export interface ArtifactEntry {
  id: string;
  label: string;
  type: string;
  source: string;
}

const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
  <span className={`artifact-tree-chevron ${open ? 'open' : 'closed'}`} aria-hidden="true">
    <svg viewBox="0 0 10 10" width="9" height="9">
      <path
        d="M3 2 L6.5 5 L3 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

interface SectionProps {
  testId: string;
  open: boolean;
  onToggle: () => void;
  iconGlyph: string;
  label: string;
  count: number;
  children: React.ReactNode;
}

const TreeSection: React.FC<SectionProps> = ({
  testId,
  open,
  onToggle,
  iconGlyph,
  label,
  count,
  children,
}) => (
  <div
    className={`artifact-tree-section ${open ? 'is-open' : 'is-closed'}`}
    data-testid={testId}
  >
    <button
      type="button"
      className="artifact-tree-section-header"
      onClick={onToggle}
      aria-expanded={open}
    >
      <Chevron open={open} />
      <span className="artifact-tree-section-icon" aria-hidden="true">{iconGlyph}</span>
      <span className="artifact-tree-section-label">{label}</span>
      <span className="artifact-tree-section-count">{count}</span>
    </button>
    {open ? <div className="artifact-tree-section-body">{children}</div> : null}
  </div>
);

export const SkillsSection: React.FC<{
  open: boolean;
  onToggle: () => void;
  skills: SkillEntry[];
}> = ({ open, onToggle, skills }) => (
  <TreeSection
    testId="artifact-tree-skills"
    open={open}
    onToggle={onToggle}
    iconGlyph="S"
    label="Skills"
    count={skills.length}
  >
    <ul className="artifact-tree-leaf-list flat">
      {skills.map((skill) => (
        <li key={skill.id} className="artifact-tree-leaf skill" title={skill.description}>
          <span className="artifact-tree-leaf-bullet" aria-hidden="true" />
          <span className="artifact-tree-leaf-name">{skill.label}</span>
          <span className="artifact-tree-leaf-meta">{skill.description}</span>
        </li>
      ))}
    </ul>
  </TreeSection>
);

export const ArtifactsSection: React.FC<{
  open: boolean;
  onToggle: () => void;
  artifacts: ArtifactEntry[];
}> = ({ open, onToggle, artifacts }) => {
  const { t } = useI18n();
  return (
  <TreeSection
    testId="artifact-tree-artifacts"
    open={open}
    onToggle={onToggle}
    iconGlyph="A"
    label="Artifacts"
    count={artifacts.length}
  >
    {artifacts.length === 0 ? (
      <div className="panel-empty">{t('control.artifactOutputsEmpty')}</div>
    ) : (
      <ul className="artifact-tree-leaf-list flat">
        {artifacts.map((artifact) => (
          <li
            key={artifact.id}
            className="artifact-tree-leaf artifact"
            title={`${artifact.type} - ${artifact.source}`}
          >
            <span className="artifact-tree-leaf-bullet" aria-hidden="true" />
            <span className="artifact-tree-leaf-name">{artifact.label}</span>
            <span className="artifact-tree-leaf-meta">{artifact.type}</span>
          </li>
        ))}
      </ul>
    )}
  </TreeSection>
  );
};
