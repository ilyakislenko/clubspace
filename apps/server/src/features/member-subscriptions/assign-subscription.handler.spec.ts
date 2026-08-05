import { AssignSubscriptionFeature } from './assign-subscription.feature';
import { AssignSubscriptionHandler } from './assign-subscription.handler';

const subRow = () => ({
  id: 's1',
  planId: 'p1',
  plan: { name: 'Monthly' },
  status: 'ACTIVE',
  startDate: new Date('2026-07-01T00:00:00Z'),
  endDate: new Date('2026-07-31T00:00:00Z'),
  amountPaid: 5000,
  currency: 'RUB',
  source: 'MANUAL',
  createdAt: new Date('2026-07-01T00:00:00Z'),
});

const rbac = (admin = true) => ({
  resolveCoachScope: jest
    .fn()
    .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
  canWriteAllGroups: jest.fn().mockReturnValue(admin),
});

describe('assignSubscription', () => {
  it('assigns and returns subscription + accessUntil', async () => {
    const prisma = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }),
      },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
      },
    };
    const service = {
      grantFromPlan: jest.fn().mockResolvedValue({
        subscription: subRow(),
        accessUntil: new Date('2026-07-31T00:00:00Z'),
      }),
    };
    const out = await new AssignSubscriptionHandler(
      prisma as never,
      rbac() as never,
      service as never,
      { invalidate: jest.fn() } as never,
    ).execute(
      new AssignSubscriptionFeature(
        { planId: 'p1' },
        'w1',
        'member',
        'u1',
        'admin',
        false,
      ),
    );
    expect(service.grantFromPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        workspaceMemberId: 'm1',
        planId: 'p1',
        source: 'MANUAL',
      }),
    );
    expect(out.subscription).toMatchObject({ id: 's1', planName: 'Monthly' });
    expect(out.accessUntil).toBe('2026-07-31T00:00:00.000Z');
  });

  it('blocks assigning to the owner', async () => {
    const prisma = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'member' }),
      },
      workspaceMember: { findFirst: jest.fn() },
    };
    const service = { grantFromPlan: jest.fn() };
    await expect(
      new AssignSubscriptionHandler(
        prisma as never,
        rbac() as never,
        service as never,
        { invalidate: jest.fn() } as never,
      ).execute(
        new AssignSubscriptionFeature(
          { planId: 'p1' },
          'w1',
          'member',
          'u1',
          'admin',
          false,
        ),
      ),
    ).rejects.toThrow(/владельца клуба/i);
    expect(service.grantFromPlan).not.toHaveBeenCalled();
  });

  it('forbids a non-admin', async () => {
    const prisma = {
      workspace: { findUnique: jest.fn() },
      workspaceMember: { findFirst: jest.fn() },
    };
    const service = { grantFromPlan: jest.fn() };
    await expect(
      new AssignSubscriptionHandler(
        prisma as never,
        rbac(false) as never,
        service as never,
        { invalidate: jest.fn() } as never,
      ).execute(
        new AssignSubscriptionFeature(
          { planId: 'p1' },
          'w1',
          'member',
          'u1',
          'coach',
          false,
        ),
      ),
    ).rejects.toThrow(/администратор/i);
  });
});
