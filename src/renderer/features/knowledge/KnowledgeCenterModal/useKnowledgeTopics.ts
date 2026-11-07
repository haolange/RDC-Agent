import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeTopicChanges, KnowledgeTopicPreview, KnowledgeTopicProposal, KnowledgeTopicSuggestion } from '@shared/types/knowledge';
import { knowledgeErrorMessage } from './knowledgeCenterModel';
import { buildTopicChanges } from './knowledgeTopicChanges';

export function useKnowledgeTopics(active: boolean, onApplied: () => Promise<void>) {
  const sequence = useRef(0);
  const flight = useRef(false);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<KnowledgeTopicProposal | null>(null);
  const [suggestions, setSuggestions] = useState<KnowledgeTopicSuggestion[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [synonyms, setSynonyms] = useState<Record<string, string>>({});
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [customLabel, setCustomLabel] = useState('');
  const [preview, setPreview] = useState<KnowledgeTopicPreview | null>(null);
  const [changes, setChanges] = useState<KnowledgeTopicChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPreview = useMemo(() => {
    if (!proposal) return false;
    try {
      const next = buildTopicChanges({ proposal, suggestions, selected, synonyms, customIds, mergeTargets });
      return Boolean(next.topics.length || next.assignments.length || next.merges?.length);
    } catch { return false; }
  }, [customIds, mergeTargets, proposal, selected, suggestions, synonyms]);

  const close = useCallback(() => {
    sequence.current++;
    setOpen(false); setBusy(false); setProposal(null); setSuggestions([]); setSelected({});
    setSynonyms({}); setMergeTargets({}); setCustomIds([]); setCustomLabel(''); setPreview(null); setChanges(null); setError(null);
  }, []);
  useEffect(() => { if (!active) close(); }, [active, close]);

  const openPanel = useCallback(async () => {
    const seq = ++sequence.current;
    setOpen(true); setBusy(true); setError(null);
    try {
      const result = await window.electronAPI.knowledge.topicSuggest();
      if (seq !== sequence.current) return;
      setProposal(result); setSuggestions(result.suggestions);
      setSynonyms(Object.fromEntries(result.suggestions.map(item => [item.topic.id, item.topic.synonyms.join(', ')])));
    } catch (cause) { if (seq === sequence.current) setError(knowledgeErrorMessage(cause)); }
    finally { if (seq === sequence.current) setBusy(false); }
  }, []);

  const toggleCard = useCallback((topicId: string, cardId: string, checked: boolean) => {
    setSelected(current => ({ ...current, [topicId]: checked
      ? [...new Set([...(current[topicId] ?? []), cardId])]
      : (current[topicId] ?? []).filter(id => id !== cardId) }));
  }, []);
  const addCustom = useCallback(() => {
    const label = customLabel.trim();
    if (!label) return;
    const id = `custom-${crypto.randomUUID()}`;
    setSuggestions(current => [...current, { topic: { id, label, synonyms: [] }, existing: false, cards: [] }]);
    setCustomIds(current => [...current, id]); setCustomLabel('');
  }, [customLabel]);

  const createPreview = useCallback(async () => {
    if (!proposal || flight.current) return;
    const seq = ++sequence.current;
    flight.current = true; setBusy(true); setError(null);
    try {
      const next = buildTopicChanges({ proposal, suggestions, selected, synonyms, customIds, mergeTargets });
      const result = await window.electronAPI.knowledge.topicPreview(next);
      if (seq !== sequence.current) return;
      setChanges(next); setPreview(result);
    } catch (cause) { if (seq === sequence.current) setError(knowledgeErrorMessage(cause)); }
    finally { flight.current = false; if (seq === sequence.current) setBusy(false); }
  }, [customIds, mergeTargets, proposal, selected, suggestions, synonyms]);

  const apply = useCallback(async () => {
    if (!preview || !changes || flight.current) return;
    const seq = ++sequence.current;
    flight.current = true; setBusy(true); setError(null);
    try {
      const result = await window.electronAPI.knowledge.topicApply({ changes, changeHash: preview.changeHash,
        confirmation: { explicitHumanConfirmation: true } });
      if (seq !== sequence.current || 'cancelled' in result) return;
      await onAppliedRef.current();
      close();
    } catch (cause) { if (seq === sequence.current) setError(knowledgeErrorMessage(cause)); }
    finally { flight.current = false; if (seq === sequence.current) setBusy(false); }
  }, [changes, close, preview]);

  return { open, busy, proposal, suggestions, selected, synonyms, mergeTargets, customLabel, preview, error, canPreview,
    setSynonyms, setMergeTargets, setCustomLabel, setPreview, toggleCard, addCustom, openPanel, createPreview, apply, close };
}
