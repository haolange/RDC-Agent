import React, { useEffect, useMemo, useState } from 'react';
import type { ToolCatalog } from '@shared/types/tool';
import type { Artifact } from '@shared/types/evidence';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useEvidenceStore } from '../../../stores/evidenceStore';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import {
  ArtifactsSection,
  SkillsSection,
  ToolsSection,
  groupTools,
  type ArtifactEntry,
  type SkillEntry,
} from './ArtifactTreeSections';

type SectionKey = 'tools' | 'skills' | 'artifacts';

export const ArtifactTree: React.FC = () => {
  const actionEvents = useEvidenceStore((state) => state.actionEvents);
  const availableSkills = useAppSettingsStore((state) => state.settings.resourceCatalog.availableSkills);
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
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
  const skills = useMemo<SkillEntry[]>(() => (
    availableSkills.map((skill) => ({
      id: skill.id,
      label: skill.label || skill.name || skill.id,
      description: skill.description || skill.id,
    }))
  ), [availableSkills]);

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

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleToolGroup = (key: string) => {
    setOpenToolGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  return (
    <div className="artifact-tree" data-testid="artifact-tree">
      <ToolsSection
        open={openSections.tools}
        onToggle={() => toggleSection('tools')}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
        groups={toolGroups}
        totalToolCount={totalToolCount}
        openToolGroups={openToolGroups}
        onToggleToolGroup={toggleToolGroup}
      />
      <SkillsSection
        open={openSections.skills}
        onToggle={() => toggleSection('skills')}
        skills={skills}
      />
      <ArtifactsSection
        open={openSections.artifacts}
        onToggle={() => toggleSection('artifacts')}
        artifacts={artifacts}
      />
    </div>
  );
};

export default ArtifactTree;
