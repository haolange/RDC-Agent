import { Icon } from '../../../../ui/Icon';
import type { ReactNode } from 'react';

/**
 * Trust for one project resource (a hook script or an MCP server): what state it is in, a warning when it changed
 * since it was trusted, and trust / revoke.
 */
export function ResourceTrustBlock({
  testId,
  state,
  title,
  hint,
  badge,
  changed,
  actions,
  children,
}: {
  testId: string;
  state: string;
  title: string;
  hint: string;
  badge: ReactNode;
  changed?: { message: string; testId: string };
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="settings-trust-block" data-testid={testId} data-trust-state={state}>
      <div className="settings-trust-copy">
        <header className="settings-trust-block-head">
          <span className="settings-trust-block-title">{title}</span>
          {badge}
        </header>
        <p className="settings-section-description">{hint}</p>
        {changed ? (
          <p className="settings-trust-change" data-testid={changed.testId}>
            <Icon name="warning" size={14} />
            {changed.message}
          </p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="settings-runtime-actions settings-trust-block-actions">{actions}</div> : null}
    </section>
  );
}
