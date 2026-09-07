/**
 * useSlashCommandAutocomplete — 斜杠命令自动补全逻辑。
 */
import { useState, useCallback } from 'react';

export function useSlashCommandAutocomplete() {
  const [slashMode, setSlashMode] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');

  const checkSlashTrigger = useCallback((value: string): boolean => {
    const trimmed = value.trimStart();
    if (trimmed.startsWith('/')) {
      const name = trimmed.slice(1).split(/\s/)[0];
      setSlashFilter(name);
      setSlashMode(true);
      return true;
    }
    setSlashMode(false);
    setSlashFilter('');
    return false;
  }, []);

  const selectCommand = useCallback((commandName: string, currentValue: string, onChange: (v: string) => void) => {
    const trimmed = currentValue.trimStart();
    const rest = trimmed.slice(trimmed.indexOf(' ') > 0 ? trimmed.indexOf(' ') : trimmed.length);
    onChange(`/${commandName}${rest}`);
    setSlashMode(false);
    setSlashFilter('');
  }, []);

  const dismissSlash = useCallback(() => {
    setSlashMode(false);
    setSlashFilter('');
  }, []);

  return { slashMode, slashFilter, checkSlashTrigger, selectCommand, dismissSlash };
}
