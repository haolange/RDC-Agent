import { Tabs } from '../../../../ui/Tabs';

export function SettingsScopeBar({
  scope,
  onScopeChange,
  canProject,
  userLabel,
  projectLabel,
  groupLabel,
}: {
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  canProject: boolean;
  userLabel: string;
  projectLabel: string;
  groupLabel: string;
}) {
  return (
    <Tabs
      className="settings-scope-bar"
      label={groupLabel}
      value={scope}
      onChange={(id) => onScopeChange(id as 'user' | 'project')}
      tabs={[
        { id: 'user', label: userLabel },
        { id: 'project', label: projectLabel, disabled: !canProject },
      ]}
    />
  );
}
