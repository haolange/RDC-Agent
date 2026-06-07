import React, { useEffect, useMemo, useState } from 'react';
import type { ToolCatalog, ToolDefinition } from '@shared/types/tool';
import type { Artifact } from '@shared/types/evidence';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useEvidenceStore } from '../../../stores/evidenceStore';

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

interface ToolGroup {
  key: string;
  label: string;
  tools: ToolDefinition[];
}

const groupTools = (tools: ToolDefinition[]): ToolGroup[] => {
  const groups: Map<string, ToolGroup> = new Map();
  TOOL_GROUP_PREFIXES.forEach((entry) => {
    groups.set(entry.key, { key: entry.key, label: entry.label, tools: [] });
  });
  groups.set('other', { key: 'other', label: 'Other', tools: [] });

  for (const tool of tools) {
    const matched = TOOL_GROUP_PREFIXES.find((entry) => tool.name.startsWith(entry.prefix));
    if (matched) {
      groups.get(matched.key)!.tools.push(tool);
    } else {
      groups.get('other')!.tools.push(tool);
    }
  }

  return Array.from(groups.values()).filter((group) => group.tools.length > 0);
};

interface SkillEntry {
  id: string;
  label: string;
  description: string;
}

const BUILTIN_SKILLS: SkillEntry[] = [
  {
    id: 'builtin.rdc-context',
    label: 'RDC Context',
    description: 'capture / replay 上下文聚合',
  },
  {
    id: 'builtin.renderdoc-glossary',
    label: 'RenderDoc Glossary',
    description: 'RenderDoc 术语解释',
  },
];

interface ArtifactEntry {
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

export const ArtifactTree: React.FC = () => {
  const actionEvents = useEvidenceStore((state) => state.actionEvents);

  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);

  const [openSections, setOpenSections] = useState({
    tools: true,
    skills: true,
    artifacts: true,
  });
  const [openToolGroups, setOpenToolGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const electronAPI = getElectronApi();
    if (!electronAPI) {
      setCatalogError('Tool catalog unavailable');
      setCatalogLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setCatalogLoading(true);
    void electronAPI.tool
      .getCatalog()
      .then((result) => {
        if (cancelled) return;
        setCatalog(result);
        setCatalogError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCatalogError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toolGroups = useMemo(
    () => (catalog?.tools ? groupTools(catalog.tools) : []),
    [catalog],
  );
  const totalToolCount = catalog?.tools.length ?? 0;

  const artifacts = useMemo<ArtifactEntry[]>(() => {
    const out: ArtifactEntry[] = [];
    const seen = new Set<string>();
    for (const event of actionEvents) {
      const payload = event.payload;
      if (!payload || typeof payload !== 'object') continue;
      const list = (payload as { artifacts?: Artifact[] }).artifacts;
      if (!Array.isArray(list)) continue;
      for (const artifact of list) {
        if (!artifact || seen.has(artifact.artifact_id)) continue;
        seen.add(artifact.artifact_id);
        const fileName = artifact.path ? artifact.path.split(/[\\/]/).pop() : undefined;
        out.push({
          id: artifact.artifact_id,
          label: fileName || artifact.artifact_id,
          type: artifact.type,
          source: event.event_type,
        });
      }
    }
    return out;
  }, [actionEvents]);

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleToolGroup = (key: string) => {
    setOpenToolGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  return (
    <div className="artifact-tree" data-testid="artifact-tree">
      <TreeSection
        testId="artifact-tree-tools"
        open={openSections.tools}
        onToggle={() => toggleSection('tools')}
        iconGlyph="🛠"
        label="Tools"
        count={totalToolCount}
      >
        {catalogLoading ? (
          <div className="artifact-tree-empty">Loading catalog…</div>
        ) : catalogError ? (
          <div className="artifact-tree-empty error">{catalogError}</div>
        ) : toolGroups.length === 0 ? (
          <div className="artifact-tree-empty">无可用工具</div>
        ) : (
          toolGroups.map((group) => {
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
                  onClick={() => toggleToolGroup(group.key)}
                  aria-expanded={groupOpen}
                >
                  <Chevron open={groupOpen} />
                  <span className="artifact-tree-group-label">{group.label}</span>
                  <span className="artifact-tree-group-count">{group.tools.length}</span>
                </button>
                {groupOpen ? (
                  <ul className="artifact-tree-leaf-list">
                    {group.tools.map((tool) => (
                      <li
                        key={tool.name}
                        className="artifact-tree-leaf"
                        title={tool.description}
                      >
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

      <TreeSection
        testId="artifact-tree-skills"
        open={openSections.skills}
        onToggle={() => toggleSection('skills')}
        iconGlyph="📋"
        label="Skills"
        count={BUILTIN_SKILLS.length}
      >
        <ul className="artifact-tree-leaf-list flat">
          {BUILTIN_SKILLS.map((skill) => (
            <li
              key={skill.id}
              className="artifact-tree-leaf skill"
              title={skill.description}
            >
              <span className="artifact-tree-leaf-bullet" aria-hidden="true" />
              <span className="artifact-tree-leaf-name">{skill.label}</span>
              <span className="artifact-tree-leaf-meta">{skill.description}</span>
            </li>
          ))}
        </ul>
      </TreeSection>

      <TreeSection
        testId="artifact-tree-artifacts"
        open={openSections.artifacts}
        onToggle={() => toggleSection('artifacts')}
        iconGlyph="📦"
        label="Artifacts"
        count={artifacts.length}
      >
        {artifacts.length === 0 ? (
          <div className="artifact-tree-empty">运行产出将在此显示</div>
        ) : (
          <ul className="artifact-tree-leaf-list flat">
            {artifacts.map((artifact) => (
              <li
                key={artifact.id}
                className="artifact-tree-leaf artifact"
                title={`${artifact.type} · ${artifact.source}`}
              >
                <span className="artifact-tree-leaf-bullet" aria-hidden="true" />
                <span className="artifact-tree-leaf-name">{artifact.label}</span>
                <span className="artifact-tree-leaf-meta">{artifact.type}</span>
              </li>
            ))}
          </ul>
        )}
      </TreeSection>
    </div>
  );
};

export default ArtifactTree;
