import React, { useMemo, useState } from 'react';
import type { Artifact } from '@shared/types/evidence';
import { useEvidenceStore } from '../../../stores/evidenceStore';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import {
  ArtifactsSection,
  SkillsSection,
  type ArtifactEntry,
  type SkillEntry,
} from './ArtifactTreeSections';

type SectionKey = 'skills' | 'artifacts';

export const ArtifactTree: React.FC = () => {
  const actionEvents = useEvidenceStore((state) => state.actionEvents);
  const availableSkills = useAppSettingsStore((state) => state.settings.resourceCatalog.availableSkills);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    skills: true,
    artifacts: true,
  });

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

  return (
    <div className="artifact-tree" data-testid="artifact-tree">
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
