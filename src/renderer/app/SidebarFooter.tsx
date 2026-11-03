import type { MouseEvent } from 'react';
import type { TranslationKey } from '../i18n';
import { ProfileAvatar } from '../patterns/ProfileAvatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

export function SidebarFooter({
  t,
  nickname,
  avatarPath,
  isUserMenuOpen,
  onCloseLeftDrawer,
  onOpenKnowledgeCenter,
  onUserMenuToggle,
}: {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  nickname: string;
  avatarPath: string | undefined;
  isUserMenuOpen: boolean;
  onCloseLeftDrawer: () => void;
  onOpenKnowledgeCenter: () => void;
  onUserMenuToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="app-sidebar-footer" data-testid="sidebar-footer">
      <Button
        variant="ghost"
        className="footer-entry sidebar-footer-entry"
        data-testid="sidebar-knowledge-center-trigger"
        onClick={() => { onCloseLeftDrawer(); onOpenKnowledgeCenter(); }}
        title={t('knowledgeCenter.title')}
        aria-label={t('knowledgeCenter.title')}
      >
        <span className="footer-entry-main">
          <span className="sidebar-knowledge-icon" aria-hidden="true">
            <Icon name="book" size={18} />
          </span>
          <span className="footer-entry-copy">
            <span className="footer-entry-title">{t('knowledgeCenter.sidebarLabel')}</span>
          </span>
        </span>
      </Button>
      <Button
        variant="ghost"
        className="footer-entry sidebar-footer-entry"
        data-testid="sidebar-user-settings-trigger"
        aria-haspopup="dialog"
        aria-expanded={isUserMenuOpen}
        aria-controls={isUserMenuOpen ? 'sidebar-user-menu' : undefined}
        onClick={(event) => { onCloseLeftDrawer(); onUserMenuToggle(event); }}
        title={t('sidebar.userSettings')}
        aria-label={t('sidebar.userSettings')}
      >
        <span className="footer-entry-main">
          <ProfileAvatar className="footer-entry-avatar" avatarPath={avatarPath} nickname={nickname} />
          <span className="footer-entry-copy">
            <span className="footer-entry-title">{nickname}</span>
          </span>
        </span>
        <span className="footer-entry-trailing">
          <span className="footer-entry-chevron">
            <Icon name="chevron-down" size={12} />
          </span>
        </span>
      </Button>
    </div>
  );
}
