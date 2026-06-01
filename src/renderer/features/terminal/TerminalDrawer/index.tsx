import React from 'react';
import { TerminalActivityPane } from './TerminalActivityPane';
import { TerminalDrawerShell } from './TerminalDrawerShell';
import { TerminalDrawerToolbar } from './TerminalDrawerToolbar';
import { useTerminalDrawer } from './useTerminalDrawer';
import './TerminalDrawer.css';

export const TerminalDrawer: React.FC = () => {
  const vm = useTerminalDrawer();

  return (
    <TerminalDrawerShell
      vm={vm}
      toolbar={<TerminalDrawerToolbar vm={vm} />}
      body={<TerminalActivityPane vm={vm} />}
    />
  );
};

export default TerminalDrawer;
