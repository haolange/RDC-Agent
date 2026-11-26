import React from 'react';
import { reportRendererFault } from '../platform/rendererFaults';
import { useAppSettingsStore } from '../stores/appSettingsStore';
import { RendererFailurePage } from './RendererFailurePage';
import type { ReactNode } from 'react';

interface RootErrorBoundaryState {
  error: Error | null;
}

/**
 * The root of the renderer: a render-time exception anywhere below shows the failure page instead of an empty
 * window, and is reported to main for the lifecycle ledger. Reload starts the renderer again from its entry.
 */
export class RootErrorBoundary extends React.Component<{ children: ReactNode }, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const fault = error instanceof Error ? error : new Error(String(error));
    void reportRendererFault({
      message: fault.message.slice(0, 2_000),
      ...(fault.stack ? { stack: fault.stack.slice(0, 16_000) } : {}),
      ...(info.componentStack ? { componentStack: info.componentStack.slice(0, 16_000) } : {}),
    }).catch((reportError: unknown) => console.error('[renderer] the render error could not be reported', reportError));
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <RendererFailurePage
        language={useAppSettingsStore.getState().settings.appearance.language}
        kind="exception"
        facts={[
          { label: 'Failure', value: 'renderer-exception' },
          { label: 'Message', value: error.message },
        ]}
        onReload={() => window.location.reload()}
      />
    );
  }
}
