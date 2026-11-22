import { priceStaffSale } from '../../domains/discounts/discounts';
import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors';
import {
  AssignSubscriptionFeature,
  AssignSubscriptionInputSchema,
} from './assign-subscription.feature';
import { AssignSubscriptionHandler } from './assign-subscription.handler';

jest.mock('../../domains/discounts/discounts', () => ({
  ...jest.requireActual('../../domains/discounts/discounts'),
  priceStaffSale: jest.fn(),
}));

beforeEach(() => (priceStaffSale as jest.Mock).mockReset());

const subRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  planId: 'p1',
  plan: { name: 'Monthly' },
  directions: [],
  status: 'ACTIVE',
  startDate: new Date('2026-07-01T00:00:00Z'),
  endDate: new Date('2026-07-31T00:00:00Z'),
  durationDays: 30,
  startsOnFirstVisit: false,
  amountPaid: 5000,
  currency: 'RUB',
  refundedAmount: 0,
  listPrice: 6000,
  discountId: null,
  discountName: null,
  discountAmount: 0,
  pricedById: 'u1',
  isPaid: true,
  paidAt: new Date('2026-07-01T00:00:00Z'),
  paymentMethod: 'CARD',
  classesTotal: null,
  classesRemaining: null,
  source: 'MANUAL',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
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

const TX = { tx: true };

type Plan = {
  isActive: boolean;
  price: number;
  currency?: string;
  directions?: { directionId: string }[];
} | null;

// The handler's collaborators: the plan, the member (with current
// abonements) and the service granting inside the handler's transaction.
const world = (o: {
  ownerId?: string;
  plan?: Plan;
  current?: Array<{ status: string; endDate: Date | null; directions?: { directionId: string }[] }>;
  sold?: Record<string, unknown>;
} = {}) => {
  const prisma = {
    workspace: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ ownerId: o.ownerId ?? 'owner', timezone: 'Asia/Tomsk' }),
    },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'm1',
        subscriptions: (o.current ?? []).map((c) => ({ directions: [], ...c })),
      }),
    },
    plan: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          o.plan === undefined
            ? { isActive: true, price: 6000, currency: 'RUB', directions: [] }
            : o.plan && { currency: 'RUB', directions: [], ...o.plan },
        ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(TX)),
  };
  const service = {
    grantFromPlanInTx: jest.fn().mockResolvedValue({
      subscription: subRow(o.sold),
      accessUntil: new Date('2026-07-31T00:00:00Z'),
    }),
  };
  return { prisma, service };
};

const exec = (
  w: ReturnType<typeof world>,
  payload: ConstructorParameters<typeof AssignSubscriptionFeature>[0],
  o: { admin?: boolean; userId?: string; invoker?: string; rbacMock?: ReturnType<typeof rbac>; auditMock?: ReturnType<typeof audit>; realtime?: { invalidate: jest.Mock } } = {},
) => {
  const admin = o.admin ?? true;
  return new AssignSubscriptionHandler(
    w.prisma as never,
    (o.rbacMock ?? rbac(admin)) as never,
    w.service as never,
    (o.realtime ?? { invalidate: jest.fn() }) as never,
    (o.auditMock ?? audit()) as never,
  ).execute(
    new AssignSubscriptionFeature(
      payload,
      'w1',
      o.userId ?? 'member',
      o.invoker ?? 'u1',
      admin ? 'admin' : 'coach',
      false,
    ),
  );
};

const coachRbac = () => {
  const r = rbac(false);
  r.assertCanWriteMember.mockResolvedValue(undefined);
  return r;
};

describe('assignSubscription', () => {
  it('assigns at the tariff price and returns subscription + accessUntil', async () => {
    const w = world();
    const out = await exec(w, { planId: 'p1' });
    expect(w.service.grantFromPlanInTx).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        workspaceId: 'w1',
        workspaceMemberId: 'm1',
        planId: 'p1',
        source: 'MANUAL',
        amountPaid: 6000,
        listPrice: 6000,
        discountId: null,
        discountName: null,
        discountAmount: 0,
        pricedById: 'u1',
      }),
    );
    // The server never applies a discount by itself.
    expect(priceStaffSale).not.toHaveBeenCalled();
    expect(out.subscription).toMatchObject({ id: 's1', planName: 'Monthly' });
    expect(out.accessUntil).toBe('2026-07-31T00:00:00.000Z');
  });

  const assignWith = async (startDate?: string, paid?: boolean) => {
    const w = world();
    await exec(w, { planId: 'p1', startDate, paid });
    return w.service.grantFromPlanInTx.mock.calls[0][1];
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
    const w = world({ ownerId: 'member' });
    await expect(exec(w, { planId: 'p1' })).rejects.toThrow(/владельца клуба/i);
    expect(w.service.grantFromPlanInTx).not.toHaveBeenCalled();
  });

  it('answers 404 for a tariff of another club', async () => {
    const w = world({ plan: null });
    await expect(exec(w, { planId: 'p1' })).rejects.toThrow('Тариф не найден');
    expect(w.service.grantFromPlanInTx).not.toHaveBeenCalled();
  });

  it('lets a coach of the member group assign, and audits the sale', async () => {
    const w = world({ sold: { amountPaid: 6000, pricedById: 'coach1' } });
    const rbacMock = coachRbac();
    const auditMock = audit();
    const realtime = { invalidate: jest.fn() };
    await exec(w, { planId: 'p1' }, { admin: false, invoker: 'coach1', rbacMock, auditMock, realtime });
    expect(rbacMock.assertCanWriteMember).toHaveBeenCalledWith(
      { scope: 'coach_own_only' },
      'member',
    );
    // The coach selling it is the journal's «Отметил» and who priced it.
    expect(w.service.grantFromPlanInTx.mock.calls[0][1]).toMatchObject({
      markedPaidById: 'coach1',
      pricedById: 'coach1',
    });
    expect(auditMock.record).toHaveBeenCalledWith({
      action: 'member.assignSubscription',
      targetType: 'member',
      targetId: 'member',
      workspaceId: 'w1',
      actorId: 'coach1',
      metadata: {
        subscriptionId: 's1',
        planName: 'Monthly',
        amount: 6000,
        paid: true,
        method: 'CARD',
        currency: 'RUB',
        listPrice: 6000,
        discountId: null,
        discountName: null,
        discountAmount: 0,
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        accessUntil: '2026-07-31T00:00:00.000Z',
      },
    });
    // Sold as paid: a new row in «Платежи».
    expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
      'members',
      'subscription',
      'payments',
    ]);
  });

  it('a sale on credit adds no journal row', async () => {
    const w = world({ sold: { isPaid: false, paidAt: null, paymentMethod: null } });
    const realtime = { invalidate: jest.fn() };
    await exec(w, { planId: 'p1', paid: false }, { realtime });
    expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members', 'subscription']);
  });

  it('forbids a coach whose groups do not include the member', async () => {
    const w = world();
    await expect(exec(w, { planId: 'p1' }, { admin: false })).rejects.toThrow(
      /не состоит в ваших группах/,
    );
    expect(w.service.grantFromPlanInTx).not.toHaveBeenCalled();
  });
});

describe('assignSubscription with a discount and a typed amount', () => {
  it('a coach and a head coach may type an amount below the price, as today; it is recorded as a one-off discount', async () => {
    for (const role of ['coach', 'head_coach']) {
      const w = world({ sold: { amountPaid: 4000, pricedById: 'coach1' } });
      const auditMock = audit();
      await new AssignSubscriptionHandler(
        w.prisma as never,
        coachRbac() as never,
        w.service as never,
        { invalidate: jest.fn() } as never,
        auditMock as never,
      ).execute(
        new AssignSubscriptionFeature({ planId: 'p1', amountPaid: 4000 }, 'w1', 'member', 'coach1', role, false),
      );
      expect(w.service.grantFromPlanInTx.mock.calls[0][1]).toMatchObject({
        amountPaid: 4000,
        listPrice: 6000,
        discountId: null,
        discountAmount: 0,
        pricedById: 'coach1',
      });
      const meta = auditMock.record.mock.calls[0][0];
      expect(meta.actorId).toBe('coach1');
      expect(meta.metadata).toMatchObject({ listPrice: 6000, amount: 4000, oneOff: 2000 });
    }
  });

  it('prices a picked discount under its lock in the sale transaction, before the grant', async () => {
    const w = world({
      sold: {
        amountPaid: 5100,
        discountId: 'd1',
        discountName: 'Студенческая',
        discountAmount: 900,
      },
    });
    const order: string[] = [];
    (priceStaffSale as jest.Mock).mockImplementation(async () => {
      order.push('price');
      return { amount: 5100, discountAmount: 900, discountId: 'd1', discountName: 'Студенческая' };
    });
    w.service.grantFromPlanInTx.mockImplementation(async () => {
      order.push('grant');
      return { subscription: subRow({ amountPaid: 5100, discountId: 'd1', discountName: 'Студенческая', discountAmount: 900 }), accessUntil: null };
    });
    const auditMock = audit();
    const out = await exec(w, { planId: 'p1', discountId: 'd1' }, { auditMock });
    expect(order).toEqual(['price', 'grant']);
    expect(priceStaffSale).toHaveBeenCalledWith(TX, {
      workspaceId: 'w1',
      discountId: 'd1',
      userId: 'member',
      item: { planId: 'p1', eventId: null, listPrice: 6000, currency: 'RUB' },
      now: expect.any(Date),
      timezone: 'Asia/Tomsk',
    });
    expect(w.service.grantFromPlanInTx.mock.calls[0][1]).toMatchObject({
      amountPaid: 5100,
      listPrice: 6000,
      discountId: 'd1',
      discountName: 'Студенческая',
      discountAmount: 900,
    });
    const meta = auditMock.record.mock.calls[0][0].metadata;
    expect(meta).toMatchObject({ discountId: 'd1', discountName: 'Студенческая', discountAmount: 900 });
    expect(meta).not.toHaveProperty('oneOff');
    expect(out.subscription).toMatchObject({ discountName: 'Студенческая', oneOffDiscount: 0 });
  });

  it('a typed amount sits on top of a discount and shows as the one-off part', async () => {
    const w = world({
      sold: { amountPaid: 5000, discountId: 'd1', discountName: 'Студенческая', discountAmount: 900 },
    });
    (priceStaffSale as jest.Mock).mockResolvedValue({
      amount: 5100,
      discountAmount: 900,
      discountId: 'd1',
      discountName: 'Студенческая',
    });
    const auditMock = audit();
    const out = await exec(w, { planId: 'p1', discountId: 'd1', amountPaid: 5000 }, { auditMock });
    expect(w.service.grantFromPlanInTx.mock.calls[0][1].amountPaid).toBe(5000);
    expect(auditMock.record.mock.calls[0][0].metadata.oneOff).toBe(100);
    expect(out.subscription.oneOffDiscount).toBe(100);
  });

  it('a refused discount sells nothing', async () => {
    const w = world();
    (priceStaffSale as jest.Mock).mockRejectedValue(
      new BadRequestError({ message: 'Лимит скидки «Весна» исчерпан' }),
    );
    await expect(exec(w, { planId: 'p1', discountId: 'd1' })).rejects.toThrow(
      'Лимит скидки «Весна» исчерпан',
    );
    expect(w.service.grantFromPlanInTx).not.toHaveBeenCalled();
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
    plan?: Plan;
    current?: {
      status: string;
      endDate: Date | null;
      directions?: { directionId: string }[];
    } | null;
  }) => {
    const admin = o.admin ?? false;
    const w = world({ plan: o.plan, current: o.current ? [o.current] : [] });
    const rbacMock = rbac(admin);
    rbacMock.assertCanWriteMember.mockResolvedValue(undefined);
    return {
      exec: () =>
        exec(w, { planId: 'p1', startDate: o.startDate }, {
          admin,
          userId: o.userId,
          invoker: o.invoker,
          rbacMock,
        }),
      service: w.service,
    };
  };

  it('lets a coach date a sale today and up to 3 days back', async () => {
    for (const startDate of ['2026-10-25', '2026-10-22']) {
      const { exec, service } = await run({ startDate });
      await exec();
      expect(service.grantFromPlanInTx).toHaveBeenCalled();
    }
  });

  it('refuses a coach start date older than 3 days or in the future', async () => {
    for (const startDate of ['2026-10-21', '2026-10-26', '2099-01-01']) {
      const { exec, service } = await run({ startDate });
      await expect(exec()).rejects.toThrow(/Тренер может оформить абонемент/);
      expect(service.grantFromPlanInTx).not.toHaveBeenCalled();
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
    expect(ok.service.grantFromPlanInTx).toHaveBeenCalled();

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

  it('bounds by the live abonement of the same directions only', async () => {
    const otherDirection = {
      status: 'ACTIVE',
      endDate: new Date('2026-11-10T07:00:00Z'),
      directions: [{ directionId: 'bjj' }],
    };
    const refused = await run({ startDate: '2026-11-10', current: otherDirection });
    await expect(refused.exec()).rejects.toThrow(/Тренер может оформить/);

    const sameScope = await run({
      startDate: '2026-11-10',
      current: otherDirection,
      plan: { isActive: true, price: 6000, directions: [{ directionId: 'bjj' }] },
    });
    await sameScope.exec();
    expect(sameScope.service.grantFromPlanInTx).toHaveBeenCalled();
  });

  it('lets an admin pick any start date', async () => {
    const { exec, service } = await run({ admin: true, startDate: '2099-01-01' });
    await exec();
    expect(service.grantFromPlanInTx).toHaveBeenCalled();
  });

  it('refuses an archived tariff for a coach but not for an admin', async () => {
    const archived = { isActive: false, price: 6000 };
    const coach = await run({ plan: archived });
    await expect(coach.exec()).rejects.toThrow(/в архиве/);
    expect(coach.service.grantFromPlanInTx).not.toHaveBeenCalled();

    const admin = await run({ admin: true, plan: archived });
    await admin.exec();
    expect(admin.service.grantFromPlanInTx).toHaveBeenCalled();
  });

  it('refuses a coach selling to themselves, an admin may', async () => {
    const coach = await run({ userId: 'u1', invoker: 'u1' });
    await expect(coach.exec()).rejects.toThrow(/самому себе/);
    expect(coach.service.grantFromPlanInTx).not.toHaveBeenCalled();

    const admin = await run({ admin: true, userId: 'u1', invoker: 'u1' });
    await admin.exec();
    expect(admin.service.grantFromPlanInTx).toHaveBeenCalled();
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

  it('accepts a discount id, never a foreign shape', () => {
    expect(AssignSubscriptionInputSchema.safeParse({ planId, discountId: planId }).success).toBe(true);
    expect(AssignSubscriptionInputSchema.safeParse({ planId, discountId: 'x' }).success).toBe(false);
  });
});
