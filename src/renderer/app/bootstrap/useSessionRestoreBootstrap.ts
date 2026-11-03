import { useEffect } from 'react';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { WorkflowState } from '@shared/types/workflow';
import { hydrateMessagesWithActionEvents, mapActionEventToTimelineEntry } from '../../services/conversationTimeline';
import { useConversationStore } from '../../stores/conversationStore';
import { useEvidenceStore } from '../../stores/evidenceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkflowStore } from '../../stores/workflowStore';

export function useSessionRestoreBootstrap(shellReady: boolean): void {
  const currentSession = useProjectStore((state) => state.currentSession);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!shellReady) return;
    if (!electronAPI || !currentSession) {
      useConversationStore.getState().setTimeline([]);
      useWorkflowStore.getState().setTracePresentation(null);
      return;
    }

    void electronAPI.evidence.getChain()
      .then((result) => {
        useEvidenceStore.getState().setActionEvents(result.events ?? []);
        const timeline = (result.events ?? [])
          .map((event) => mapActionEventToTimelineEntry(event as ActionEvent))
          .filter((entry): entry is AgentTimelineEntry => entry !== null);
        useConversationStore.getState().setTimeline(timeline);
        useConversationStore.getState().setConversationMessages(
          hydrateMessagesWithActionEvents(
            useConversationStore.getState().allConversationMessages,
            (result.events ?? []) as ActionEvent[],
          ),
        );
      })
      .catch(() => {
        useEvidenceStore.getState().setActionEvents([]);
        useConversationStore.getState().setTimeline([]);
      });

    void electronAPI.workflow.getState()
      .then((state) => {
        if (!state) {
          useWorkflowStore.getState().setWorkflowState(null);
          useConversationStore.getState().setReasoningSummaries([]);
          return;
        }
        const workflow = state as WorkflowState;
        useWorkflowStore.getState().setWorkflowState(workflow);
        useConversationStore.getState().setReasoningSummaries(workflow.reasoningSummaries ?? []);
      })
      .catch(() => undefined);

    if (useWorkflowStore.getState().tracePresentation?.sessionId !== currentSession.sessionId) {
      void electronAPI.trace.getProjection(currentSession.sessionId)
        .then((result) => {
          useWorkflowStore.getState().setTracePresentation(result.presentation ?? null);
        })
        .catch(() => {
          useWorkflowStore.getState().setTracePresentation(null);
        });
    }
  }, [currentSession, shellReady]);
}
