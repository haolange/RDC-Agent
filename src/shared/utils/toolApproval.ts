/** Review provenance is host-owned; risk and model-authored text cannot make a request actionable. */
export function isAutomaticToolApproval(approval: { reviewer?: unknown }): boolean {
  return approval.reviewer === 'auto_review';
}
