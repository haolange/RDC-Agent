import { useCallback, useState } from 'react';

export type KnowledgeImportMode = 'file' | 'paste';

/**
 * What an import reads: a chosen or dropped file, or pasted text, and the space it goes into. Any change to them
 * outdates the preview; switching between file and paste also clears the other input and the last error.
 */
export function useKnowledgeImportSource(
  initialSpaceId: string,
  setPreview: (preview: null) => void,
  setError: (error: null) => void,
) {
  const [mode, setMode] = useState<KnowledgeImportMode>('file');
  const [source, setSource] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState(initialSpaceId);

  const changeMode = useCallback(
    (next: KnowledgeImportMode) => {
      setMode(next);
      setError(null);
      setPreview(null);
      if (next === 'file') setSource('');
      else setFilePath(null);
    },
    [setError, setPreview],
  );
  const changeSource = useCallback(
    (next: string) => {
      setSource(next);
      setPreview(null);
    },
    [setPreview],
  );
  const changeSpace = useCallback(
    (next: string) => {
      setSpaceId(next);
      setPreview(null);
    },
    [setPreview],
  );
  const chooseFile = useCallback((next: string) => {
    setFilePath(next);
    setSource('');
  }, []);
  const resetSource = useCallback(() => {
    setMode('file');
    setSource('');
    setFilePath(null);
  }, []);

  return {
    source,
    filePath,
    spaceId,
    setSpaceId,
    chooseFile,
    resetSource,
    view: { mode, source, filePath, spaceId, setMode: changeMode, setSource: changeSource, setSpaceId: changeSpace },
  };
}
