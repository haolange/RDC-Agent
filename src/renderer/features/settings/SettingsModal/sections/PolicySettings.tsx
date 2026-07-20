import React from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { RuntimeScopePanel } from './RuntimeScopePanel';

export const PolicySettings: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  onChanged: (overview: RdxRuntimeOverview) => void;
}> = ({ overview, scope, onScopeChange, onChanged }) => (
  <section className="settings-page settings-page-policy">
    <RuntimeScopePanel
      overview={overview}
      scope={scope}
      onScopeChange={onScopeChange}
      kinds={['policy']}
      onChanged={onChanged}
    />
  </section>
);
