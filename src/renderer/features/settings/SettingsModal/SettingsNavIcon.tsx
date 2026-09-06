import React from 'react';
import { Icon, type IconName } from '../../../ui/Icon';
import type { SettingsSection } from './types';

const SECTION_ICON: Record<SettingsSection, IconName> = {
  general: 'nav-general',
  appearance: 'nav-appearance',
  workspace: 'nav-workspace',
  models: 'nav-models',
  skills: 'nav-skills',
  agents: 'nav-agents',
  tools: 'nav-tools',
  hooks: 'nav-hooks',
  policy: 'nav-policy',
};

interface SettingsNavIconProps {
  section: SettingsSection;
}

export const SettingsNavIcon: React.FC<SettingsNavIconProps> = ({ section }) => (
  <Icon name={SECTION_ICON[section]} size={16} className="settings-center-nav-icon" />
);
