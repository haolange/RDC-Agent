import React from 'react';
import type { ToolDefinition } from '@shared/types/tool';
import { useI18n } from '../../../i18n';

const TOOL_GROUP_PREFIXES: Array<{ key: string; label: string; prefix: string }> = [
  { key: 'core', label: 'RDC Core', prefix: 'rd.core.' },
  { key: 'shader', label: 'Shader', prefix: 'rd.shader.' },
  { key: 'texture', label: 'Texture', prefix: 'rd.texture.' },
  { key: 'capture', label: 'Capture', prefix: 'rd.capture.' },
  { key: 'pipeline', label: 'Pipeline', prefix: 'rd.pipeline.' },
  { key: 'event', label: 'Event', prefix: 'rd.event.' },
  { key: 'session', label: 'Session', prefix: 'rd.session.' },
  { key: 'resource', label: 'Resource', prefix: 'rd.resource.' },
  { key: 'remote', label: 'Remote', prefix: 'rd.remote.' },
  { key: 'primitive', label: 'Primitives', prefix: 'primitive.' },
];

export interface ToolGroup {
  key: string;
  label: string;
  tools: ToolDefinition[];
}

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

export const groupTools = (tools: ToolDefinition[]): ToolGroup[] => {
  const groups: Map<string, ToolGroup> = new Map();
  TOOL_GROUP_PREFIXES.forEach((entry) => {
    groups.set(entry.key, { key: entry.key, label: entry.label, tools: [] });
  });
  groups.set('other', { key: 'other', label: 'Other', tools: [] });

  for (const tool of tools) {
    const matched = TOOL_GROUP_PREFIXES.find((entry) => tool.name.startsWith(entry.prefix));
    groups.get(matched?.key ?? 'other')!.tools.push(tool);
  }

  return Array.from(groups.values()).filter((group) => group.tools.length > 0);
};

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

export const ToolsSection: React.FC<{
  open: boolean;
  onToggle: () => void;
  catalogLoading: boolean;
  catalogError: string | null;
  groups: ToolGroup[];
  totalToolCount: number;
  openToolGroups: Record<string, boolean>;
  onToggleToolGroup: (key: string) => void;
}> = ({
  open,
  onToggle,
  catalogLoading,
  catalogError,
  groups,
  totalToolCount,
  openToolGroups,
  onToggleToolGroup,
}) => {
  const { t } = useI18n();
  return (
  <TreeSection
    testId="artifact-tree-tools"
    open={open}
    onToggle={onToggle}
    iconGlyph="T"
    label="Tools"
    count={totalToolCount}
  >
    {catalogLoading ? (
      <div className="panel-empty">{t('control.artifactCatalogLoading')}</div>
    ) : catalogError ? (
      <div className="panel-empty error">{catalogError}</div>
    ) : groups.length === 0 ? (
      <div className="panel-empty">{t('control.artifactNoTools')}</div>
    ) : (
      groups.map((group) => {
        const groupOpen = openToolGroups[group.key] ?? group.key === 'core';
        return (
          <div
            key={group.key}
            className={`artifact-tree-group ${groupOpen ? 'is-open' : 'is-closed'}`}
            data-testid={`artifact-tree-group-${group.key}`}
          >
            <button
              type="button"
              className="artifact-tree-group-header"
              onClick={() => onToggleToolGroup(group.key)}
              aria-expanded={groupOpen}
            >
              <Chevron open={groupOpen} />
              <span className="artifact-tree-group-label">{group.label}</span>
              <span className="artifact-tree-group-count">{group.tools.length}</span>
            </button>
            {groupOpen ? (
              <ul className="artifact-tree-leaf-list">
                {group.tools.map((tool) => (
                  <li key={tool.name} className="artifact-tree-leaf" title={tool.description}>
                    <span className="artifact-tree-leaf-bullet" aria-hidden="true" />
                    <span className="artifact-tree-leaf-name">{tool.name}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })
    )}
  </TreeSection>
  );
};

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
