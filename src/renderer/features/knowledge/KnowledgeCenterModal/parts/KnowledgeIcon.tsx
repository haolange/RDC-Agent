import { Icon, type IconName } from '../../../../ui/Icon';

export type KnowledgeIconName = Extract<IconName, 'book' | 'inbox' | 'conflict' | 'folder' | 'upload' | 'filter'>;

export function KnowledgeIcon({ name }: { name: KnowledgeIconName }) {
  return <Icon name={name} size={18} />;
}
