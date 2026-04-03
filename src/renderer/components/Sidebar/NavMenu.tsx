import React from 'react';

export type NavItemKey = 'new-task' | 'session-history';

interface NavItem {
  key: NavItemKey;
  label: string;
  icon: React.ReactNode;
}

interface NavMenuProps {
  activeKey: NavItemKey;
  onSelect: (key: NavItemKey) => void;
}

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8 3V13M3 8H13"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.5V8L10.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const navItems: NavItem[] = [
  {
    key: 'new-task',
    label: '\u65b0\u4efb\u52a1',
    icon: <PlusIcon />,
  },
  {
    key: 'session-history',
    label: 'Session\u5386\u53f2',
    icon: <ClockIcon />,
  },
];

export const NavMenu: React.FC<NavMenuProps> = ({ activeKey, onSelect }) => {
  return (
    <nav className="nav-menu">
      {navItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`nav-item ${item.key === activeKey ? 'active' : ''} ${item.key === 'new-task' ? 'new-task' : ''}`}
          onClick={() => onSelect(item.key)}
        >
          <span className="nav-item-icon">{item.icon}</span>
          <span className="nav-item-text">{item.label}</span>
        </button>
      ))}
    </nav>
  );
};
