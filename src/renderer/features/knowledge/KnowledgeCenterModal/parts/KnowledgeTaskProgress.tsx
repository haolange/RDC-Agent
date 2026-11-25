import { Spinner } from '../../../../ui/Spinner';
import './knowledge-task-progress.css';

/**
 * A long knowledge task in progress (reading, importing, exporting, rebuilding), stated beside the dialog's actions.
 * Main reports no fraction done for these tasks, so it says what is running without inventing a percentage.
 */
export function KnowledgeTaskProgress({ label }: { label: string }) {
  return (
    <span className="task-dialog-footer-spacer knowledge-task-progress" role="status" data-testid="knowledge-task-progress">
      <Spinner size="sm" />
      <span>{label}</span>
    </span>
  );
}
