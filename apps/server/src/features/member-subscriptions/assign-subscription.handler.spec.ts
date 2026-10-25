import { ForbiddenError } from '../../shared/errors/shared.errors';
import {
  AssignSubscriptionFeature,
  AssignSubscriptionInputSchema,
} from './assign-subscription.feature';
import { AssignSubscriptionHandler } from './assign-subscription.handler';

const subRow = () => ({
  id: 's1',
  planId: 'p1',
  plan: { name: 'Monthly' },
  status: 'ACTIVE',
  startDate: new Date('2026-07-01T00:00:00Z'),
  endDate: new Date('2026-07-31T00:00:00Z'),
  durationDays: 30,
  startsOnFirstVisit: false,
  amountPaid: 5000,
  currency: 'RUB',
  isPaid: true,
  paidAt: new Date('2026-07-01T00:00:00Z'),
  source: 'MANUAL',
  createdAt: new Date('2026-07-01T00:00:00Z'),
});

const rbac = (admin = true) => ({
  resolveCoachScope: jest
    .fn()
    .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
  canWriteAllGroups: jest.fn().mockReturnValue(admin),
  assertCanWriteMember: jest.fn().mockImplementation(async () => {
    if (!admin) {
      throw new ForbiddenError({
        message: 'Участник не состоит в ваших группах',
      });
    }
  }),
});

const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) });

describe('assignSubscription', () => {
  it('assigns and returns subscription + accessUntil', async () => {
    const prisma = {
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ownerId: 'owner', timezone: 'Asia/Tomsk' }),
      },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
      },
      plan: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ isActive: true, price: 6000 }),
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
      audit() as never,
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

  const assignWith = async (startDate?: string, paid?: boolean) => {
    const prisma = {
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ownerId: 'owner', timezone: 'Asia/Tomsk' }),
      },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
      },
      plan: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ isActive: true, price: 6000 }),
      },
    };
    const service = {
      grantFromPlan: jest.fn().mockResolvedValue({
        subscription: subRow(),
        accessUntil: new Date('2026-07-31T00:00:00Z'),
      }),
    };
    await new AssignSubscriptionHandler(
      prisma as never,
      rbac() as never,
      service as never,
      { invalidate: jest.fn() } as never,
      audit() as never,
    ).execute(
      new AssignSubscriptionFeature(
        { planId: 'p1', startDate, paid },
        'w1',
        'member',
        'u1',
        'admin',
        false,
      ),
    );
    return service.grantFromPlan.mock.calls[0][0];
  };

  it('parses an explicit start date as club-local midnight', async () => {
    const call = await assignWith('2026-07-01');
    // Tomsk is UTC+7: local midnight is 17:00 UTC the day before.
    expect(call.startDate.toISOString()).toBe('2026-06-30T17:00:00.000Z');
  });

  it('passes no start date when omitted, so the plan decides', async () => {
    const call = await assignWith();
    expect(call.startDate).toBeUndefined();
  });

  it('passes paid through, so an unpaid sale can be recorded', async () => {
    expect((await assignWith(undefined, false)).paid).toBe(false);
    expect((await assignWith()).paid).toBeUndefined();
  });

  it('blocks assigning to the owner', async () => {
    const prisma = {
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ownerId: 'member', timezone: 'Asia/Tomsk' }),
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
        audit() as never,
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

  it('lets a coach of the member group assign, and audits the sale', async () => {
    const prisma = {
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ownerId: 'owner', timezone: 'Asia/Tomsk' }),
      },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
      },
      plan: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ isActive: true, price: 6000 }),
      },
    };
    const service = {
      grantFromPlan: jest.fn().mockResolvedValue({
        subscription: subRow(),
        accessUntil: new Date('2026-07-31T00:00:00Z'),
      }),
    };
    const rbacMock = rbac(false);
    rbacMock.assertCanWriteMember.mockResolvedValue(undefined);
    const auditMock = audit();
    const realtime = { invalidate: jest.fn() };
    await new AssignSubscriptionHandler(
      prisma as never,
      rbacMock as never,
      service as never,
      realtime as never,
      auditMock as never,
    ).execute(
      new AssignSubscriptionFeature(
        { planId: 'p1' },
        'w1',
        'member',
        'coach1',
        'coach',
        false,
      ),
    );
    expect(rbacMock.assertCanWriteMember).toHaveBeenCalledWith(
      { scope: 'coach_own_only' },
      'member',
    );
    expect(service.grantFromPlan).toHaveBeenCalled();
    expect(auditMock.record).toHaveBeenCalledWith({
      action: 'member.assignSubscription',
      targetType: 'member',
      targetId: 'member',
      workspaceId: 'w1',
      actorId: 'coach1',
      metadata: {
        planName: 'Monthly',
        amount: 5000,
        paid: true,
        currency: 'RUB',
        listPrice: 6000,
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-31T00:00:00.000Z',
        accessUntil: '2026-07-31T00:00:00.000Z',
      },
    });
    expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
      'members',
      'subscription',
    ]);
  });

  it('forbids a coach whose groups do not include the member', async () => {
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
        audit() as never,
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
    ).rejects.toThrow(/не состоит в ваших группах/);
    expect(service.grantFromPlan).not.toHaveBeenCalled();
  });
});

describe('assignSubscription coach bounds', () => {
  const NOW = new Date('2026-10-25T05:00:00Z'); // 12:00 in Tomsk, 2026-10-25

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const run = async (o: {
    admin?: boolean;
    startDate?: string;
    userId?: string;
    invoker?: string;
    plan?: { isActive: boolean; price: number } | null;
    current?: { status: string; endDate: Date | null } | null;
  }) => {
    const admin = o.admin ?? false;
    const prisma = {
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ownerId: 'owner', timezone: 'Asia/Tomsk' }),
      },
      workspaceMember: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'm1', subscription: o.current ?? null }),
      },
      plan: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            o.plan === undefined ? { isActive: true, price: 6000 } : o.plan,
          ),
      },
    };
    const service = {
      grantFromPlan: jest.fn().mockResolvedValue({
        subscription: subRow(),
        accessUntil: new Date('2026-07-31T00:00:00Z'),
      }),
    };
    const rbacMock = rbac(admin);
    rbacMock.assertCanWriteMember.mockResolvedValue(undefined);
    const exec = () =>
      new AssignSubscriptionHandler(
        prisma as never,
        rbacMock as never,
        service as never,
        { invalidate: jest.fn() } as never,
        audit() as never,
      ).execute(
        new AssignSubscriptionFeature(
          { planId: 'p1', startDate: o.startDate },
          'w1',
          o.userId ?? 'member',
          o.invoker ?? 'u1',
          admin ? 'admin' : 'coach',
          false,
        ),
      );
    return { exec, service };
  };

  it('lets a coach date a sale today and up to 3 days back', async () => {
    for (const startDate of ['2026-10-25', '2026-10-22']) {
      const { exec, service } = await run({ startDate });
      await exec();
      expect(service.grantFromPlan).toHaveBeenCalled();
    }
  });

  it('refuses a coach start date older than 3 days or in the future', async () => {
    for (const startDate of ['2026-10-21', '2026-10-26', '2099-01-01']) {
      const { exec, service } = await run({ startDate });
      await expect(exec()).rejects.toThrow(/Тренер может оформить абонемент/);
      expect(service.grantFromPlan).not.toHaveBeenCalled();
    }
  });

  it('lets a coach renew back-to-back from the day the live abonement ends', async () => {
    // Ends 2026-11-10 14:00 Tomsk = 07:00Z; the club-local day is the bound.
    const current = {
      status: 'ACTIVE',
      endDate: new Date('2026-11-10T07:00:00Z'),
    };
    const ok = await run({ startDate: '2026-11-10', current });
    await ok.exec();
    expect(ok.service.grantFromPlan).toHaveBeenCalled();

    const late = await run({ startDate: '2026-11-11', current });
    await expect(late.exec()).rejects.toThrow(/Тренер может оформить/);
  });

  it('ignores an expired abonement end for the upper bound', async () => {
    const { exec } = await run({
      startDate: '2026-10-30',
      current: { status: 'ACTIVE', endDate: new Date('2026-10-01T00:00:00Z') },
    });
    await expect(exec()).rejects.toThrow(/Тренер может оформить/);
  });

  it('lets an admin pick any start date', async () => {
    const { exec, service } = await run({ admin: true, startDate: '2099-01-01' });
    await exec();
    expect(service.grantFromPlan).toHaveBeenCalled();
  });

  it('refuses an archived tariff for a coach but not for an admin', async () => {
    const archived = { isActive: false, price: 6000 };
    const coach = await run({ plan: archived });
    await expect(coach.exec()).rejects.toThrow(/в архиве/);
    expect(coach.service.grantFromPlan).not.toHaveBeenCalled();

    const admin = await run({ admin: true, plan: archived });
    await admin.exec();
    expect(admin.service.grantFromPlan).toHaveBeenCalled();
  });

  it('lets an unknown plan reach the service, which answers 404', async () => {
    const { exec, service } = await run({ plan: null });
    await exec();
    expect(service.grantFromPlan).toHaveBeenCalled();
  });

  it('refuses a coach selling to themselves, an admin may', async () => {
    const coach = await run({ userId: 'u1', invoker: 'u1' });
    await expect(coach.exec()).rejects.toThrow(/самому себе/);
    expect(coach.service.grantFromPlan).not.toHaveBeenCalled();

    const admin = await run({ admin: true, userId: 'u1', invoker: 'u1' });
    await admin.exec();
    expect(admin.service.grantFromPlan).toHaveBeenCalled();
  });
});

describe('AssignSubscriptionInputSchema amountPaid', () => {
  const planId = '4f6c1f0e-8f0b-4b0e-9a63-0f2f6d3b2a11';

  it('accepts 0 and the 10 000 000 cap, like mark-paid', () => {
    expect(
      AssignSubscriptionInputSchema.safeParse({ planId, amountPaid: 0 }).success,
    ).toBe(true);
    expect(
      AssignSubscriptionInputSchema.safeParse({ planId, amountPaid: 10_000_000 })
        .success,
    ).toBe(true);
  });

  it('rejects an amount above the cap', () => {
    expect(
      AssignSubscriptionInputSchema.safeParse({ planId, amountPaid: 10_000_001 })
        .success,
    ).toBe(false);
  });
});
