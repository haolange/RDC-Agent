import { describe, expect, it, vi } from 'vitest';

const release = vi.hoisted(() => vi.fn());
vi.mock('../../settings/provider-auth/ProviderRuntimeCredentialLease', () => ({
  freezeProviderRuntimeCredentials: vi.fn(),
  releaseProviderRuntimeCredentials: release,
}));

import { withPermissionReviewRoute, type PermissionReviewRoute } from './PermissionReviewRoute';

const ready = (providerId: string): PermissionReviewRoute => ({
  status: 'ready',
  requestPlan: { providerId, effectiveModelId: 'review-model' } as never,
  reasoning: {} as never,
});
const turn = { providerId: 'turn-provider', credentialHandle: 'turn-lease' };

describe('permission review route', () => {
  it('refuses an unavailable review route with a registered code and never runs the review on the turn model', async () => {
    const review = vi.fn();
    const lease = vi.fn();
    await expect(
      withPermissionReviewRoute({ status: 'unavailable', reason: 'no model' }, turn, review, lease),
    ).rejects.toMatchObject({ code: 'PERMISSION_REVIEW_ROUTE_UNAVAILABLE' });
    expect(review).not.toHaveBeenCalled();
    expect(lease).not.toHaveBeenCalled();
  });

  it("reuses the turn's lease for the same provider and leases another provider only for the request", async () => {
    const lease = vi.fn(async () => 'review-lease');
    const review = vi.fn(async (_route: unknown, handle: string) => handle);
    await expect(withPermissionReviewRoute(ready('turn-provider'), turn, review, lease)).resolves.toBe('turn-lease');
    expect(lease).not.toHaveBeenCalled();
    await expect(withPermissionReviewRoute(ready('review-provider'), turn, review, lease)).resolves.toBe(
      'review-lease',
    );
    expect(lease).toHaveBeenCalledWith('review-provider');
    expect(release).toHaveBeenCalledWith('review-lease');
  });

  it('refuses when the review provider cannot lease credentials', async () => {
    await expect(
      withPermissionReviewRoute(ready('review-provider'), turn, vi.fn(), async () => {
        throw new Error('signed out');
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_REVIEW_ROUTE_UNAVAILABLE' });
  });
});
