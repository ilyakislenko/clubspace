import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start';
import { UnmarkRecordFeature } from './unmark-record.feature';
import { UnmarkRecordHandler } from './unmark-record.handler';

jest.mock('../../domains/subscriptions/first-visit-start', () => ({
  syncFirstVisitStartInTx: jest.fn().mockResolvedValue('unchanged'),
}));

// Isolate the refund logic — session access + roster rebuild are covered
// elsewhere and would otherwise need their own prisma fixtures.
jest.mock('./session-access', () => ({
  loadSessionForWrite: jest
    .fn()
    .mockResolvedValue({ id: 'sess1', workspaceId: 'w1' }),
}));
jest.mock('./roster', () => ({
  buildRoster: jest.fn().mockResolvedValue({ present: [], absent: [] }),
}));

const makePrisma = (opts: {
  consumedSubscriptionId?: string | null;
  deletedCount?: number;
  sub?: {
    id: string;
    classesRemaining: number | null;
    classesTotal: number | null;
  } | null;
}) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = {
    attendanceRecord: {
      findUnique: jest.fn().mockResolvedValue({
        consumedSubscriptionId: opts.consumedSubscriptionId ?? null,
      }),
      deleteMany: jest
        .fn()
        .mockResolvedValue({ count: opts.deletedCount ?? 1 }),
    },
    subscription: {
      findUnique: jest.fn().mockResolvedValue(opts.sub ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  p.$transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(p));
  return p;
};

const rbac = () => ({
  resolveCoachScope: jest
    .fn()
    .mockResolvedValue({ scope: 'admin', userId: 'u1', workspaceId: 'w1' }),
});

const run = (prisma: ReturnType<typeof makePrisma>, invalidate = jest.fn()) =>
  new UnmarkRecordHandler(prisma as never, rbac() as never, {
    invalidate,
  } as never).execute(
    new UnmarkRecordFeature('w1', 'sess1', 'm1', 'u1', 'admin', false),
  );

describe('unmarkRecord — class refund', () => {
  it('refunds the exact pack the check-in consumed', async () => {
    const prisma = makePrisma({
      consumedSubscriptionId: 'sub1',
      sub: { id: 'sub1', classesRemaining: 3, classesTotal: 8 },
    });
    await run(prisma);
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
      where: { id: 'sub1' },
      select: { id: true, classesRemaining: true, classesTotal: true },
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub1' },
      data: { classesRemaining: { increment: 1 } },
    });
  });

  it('does NOT refund when the check-in consumed nothing (trained past an exhausted pack)', async () => {
    const prisma = makePrisma({ consumedSubscriptionId: null });
    await run(prisma);
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('never refunds above the pack size (remaining === total)', async () => {
    const prisma = makePrisma({
      consumedSubscriptionId: 'sub1',
      sub: { id: 'sub1', classesRemaining: 8, classesTotal: 8 },
    });
    await run(prisma);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('is a no-op (no refund, no invalidate) when nothing was un-marked', async () => {
    const prisma = makePrisma({
      consumedSubscriptionId: 'sub1',
      deletedCount: 0,
    });
    const invalidate = jest.fn();
    await run(prisma, invalidate);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refreshes attendance/leaderboard/subscription after a successful un-mark', async () => {
    const prisma = makePrisma({ consumedSubscriptionId: null });
    const invalidate = jest.fn();
    await run(prisma, invalidate);
    expect(invalidate).toHaveBeenCalledWith('w1', [
      'attendance',
      'leaderboard',
      'subscription',
    ]);
  });

  it('re-derives the first-visit start inside the transaction after deleting', async () => {
    (syncFirstVisitStartInTx as jest.Mock).mockClear();
    const prisma = makePrisma({ consumedSubscriptionId: null });
    await run(prisma);
    expect(syncFirstVisitStartInTx).toHaveBeenCalledWith(prisma, {
      workspaceId: 'w1',
      userId: 'm1',
      now: expect.any(Date),
    });
  });

  it('does not touch the first-visit start when nothing was un-marked', async () => {
    (syncFirstVisitStartInTx as jest.Mock).mockClear();
    const prisma = makePrisma({ consumedSubscriptionId: 'sub1', deletedCount: 0 });
    await run(prisma);
    expect(syncFirstVisitStartInTx).not.toHaveBeenCalled();
  });
});
