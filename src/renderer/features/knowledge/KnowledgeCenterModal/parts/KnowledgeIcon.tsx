import { Icon, type IconName, type IconSize } from '../../../../ui/Icon';

export type KnowledgeIconName = Extract<IconName, 'book' | 'inbox' | 'conflict' | 'upload' | 'filter'>;

export function KnowledgeIcon({ name, size = 18 }: { name: KnowledgeIconName; size?: IconSize }) {
  return <Icon name={name} size={size} />;
}
