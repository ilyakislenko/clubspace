import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors';
import { syncLastAttendedAt } from './last-attended';
import { MarkRecordsFeature } from './mark-records.feature';
import { MarkRecordsHandler } from './mark-records.handler';

jest.mock('../../domains/subscriptions/first-visit-start', () => ({
  syncFirstVisitStartInTx: jest.fn().mockResolvedValue('unchanged'),
}));
// Own unit (last-attended.spec.ts); kept off the shared $executeRaw mock.
jest.mock('./last-attended', () => ({ syncLastAttendedAt: jest.fn() }));

beforeEach(() => (syncFirstVisitStartInTx as jest.Mock).mockClear());

const LIVE = new Date(Date.now() + 30 * 24 * 3600 * 1000);
const dir = (id: string) => ({
  directionId: id,
  direction: { id, name: id.toUpperCase(), color: null, icon: null },
});

// A current abonement as loadVisitCandidates reads it.
const sub = (
  userId: string,
  id: string,
  over: {
    classesTotal?: number | null;
    classesRemaining?: number | null;
    directions?: string[];
    endDate?: Date | null;
    status?: string;
    frozen?: boolean;
    startsOnFirstVisit?: boolean;
    createdAt?: Date;
  } = {},
) => ({
  id,
  status: over.status ?? 'ACTIVE',
  startDate: null,
  endDate: over.endDate === undefined ? LIVE : over.endDate,
  createdAt: over.createdAt ?? new Date('2026-09-01T00:00:00Z'),
  classesTotal: over.classesTotal === undefined ? 10 : over.classesTotal,
  classesRemaining: over.classesRemaining === undefined ? 5 : over.classesRemaining,
  startsOnFirstVisit: over.startsOnFirstVisit ?? false,
  plan: { name: `Plan ${id}` },
  workspaceMember: { userId },
  directions: (over.directions ?? []).map(dir),
  freezes: over.frozen ? [{ id: 'fr' }] : [],
});

const makePrisma = (subs: unknown[] = []) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = {
    attendanceSession: { findFirst: jest.fn(), findUnique: jest.fn() },
    workspace: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ ownerId: 'owner', timezone: 'Europe/Moscow' }),
    },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    groupMember: { findMany: jest.fn().mockResolvedValue([]) },
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
    classBooking: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // A fixed group: the roster is its members.
    group: { findUnique: jest.fn().mockResolvedValue({ bookingMode: 'FIXED', capacity: null }) },
    personalTrainingRequest: { findUnique: jest.fn().mockResolvedValue(null) },
    attendanceRecord: {
      // ON CONFLICT DO NOTHING RETURNING: by default every row is new.
      createManyAndReturn: jest.fn(
        async ({ data }: { data: Array<{ userId: string }> }) =>
          data.map((d) => ({ userId: d.userId })),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscription: {
      // By default the guarded decrement draws from every pack it targets.
      updateManyAndReturn: jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, classesRemaining: 4 })),
      ),
      // Current abonements of the members asked for (loadVisitCandidates);
      // nothing for the roster's other lookups.
      findMany: jest.fn(
        async ({ where }: { where: { workspaceMember?: { userId?: { in: string[] } }; isPaid?: boolean } }) =>
          where.isPaid === false || !where.workspaceMember?.userId
            ? []
            : (subs as Array<{ workspaceMember: { userId: string } }>).filter((s) =>
                where.workspaceMember!.userId!.in.includes(s.workspaceMember.userId),
              ),
      ),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: { findMany: jest.fn().mockResolvedValue([]) },
    subscriptionFreeze: { findMany: jest.fn().mockResolvedValue([]) },
  };
  // Run the transaction callback against the same mock.
  p.$transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(p));
  return p;
};

const makeRbac = () => ({
  resolveCoachScope: jest.fn().mockResolvedValue({
    scope: 'admin',
    userId: 'u1',
    workspaceId: 'w1',
    workspaceOwnerId: 'owner',
  }),
  assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
  canWriteAllGroups: jest.fn().mockReturnValue(true),
  canSeeAllGroups: jest.fn().mockReturnValue(true),
});

const run = async (
  prisma: any,
  rbac: any,
  sessionId: string,
  userIds: string[],
  abonements?: Array<{ userId: string; subscriptionId: string }>,
) => {
  const realtime = {
    invalidateCoalesced: jest.fn(),
    invalidateUsersInWorkspace: jest.fn(),
  };
  const followUps = { schedule: jest.fn() };
  const leaderboard = { invalidate: jest.fn().mockResolvedValue(undefined) };
  const out = await new MarkRecordsHandler(
    prisma,
    rbac,
    realtime as never,
    followUps as never,
    leaderboard as never,
  ).execute(
    new MarkRecordsFeature(
      { userIds, abonements },
      'w1',
      sessionId,
      'u1',
      'admin',
      false,
    ),
  );
  return { out, realtime, followUps, leaderboard };
};

// The one tagging statement: [userId, usedSubscriptionId, consumedSubscriptionId]
// per member, read from the VALUES list.
const taggedRows = (prisma: any) => {
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  const [, values, sessionId] = prisma.$executeRaw.mock.calls[0];
  expect(sessionId).toBe('sess1');
  const flat: unknown[] = values.values;
  const rows: unknown[][] = [];
  for (let i = 0; i < flat.length; i += 3) rows.push(flat.slice(i, i + 3));
  return rows;
};

const groupSession = {
  id: 'sess1',
  workspaceId: 'w1',
  groupId: 'g1',
  slotId: 's1',
  occurrenceKey: 'slot:s1:2026-10-24',
  workspaceEventId: null,
  isPersonal: false,
  startAt: new Date('2026-10-24T16:00:00Z'),
  timezone: 'Europe/Moscow',
};
const sessionIn = (directionId: string | null) =>
  jest.fn().mockResolvedValue({ group: { directionId }, workspaceEvent: null });

const groupPrisma = (subs: unknown[], members = ['m1']) => {
  const prisma = makePrisma(subs);
  prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
  prisma.workspaceMember.findMany.mockResolvedValue(members.map((userId) => ({ userId })));
  return prisma;
};

describe('markRecords — access', () => {
  it('refuses a coach of another group before writing anything', async () => {
    const prisma = groupPrisma([sub('m1', 'sub1')]);
    const rbac = makeRbac();
    rbac.assertCanWriteGroup.mockRejectedValue(new ForbiddenError({ message: 'no' }));
    await expect(run(prisma, rbac, 'sess1', ['m1'])).rejects.toBeInstanceOf(ForbiddenError);
    expect(rbac.assertCanWriteGroup).toHaveBeenCalledWith(expect.anything(), 'g1');
    expect(prisma.attendanceRecord.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('404s on an unknown session', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(null);
    await expect(run(prisma, makeRbac(), 'nope', ['m1'])).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('markRecords', () => {
  it('records a personal session but never draws an abonement', async () => {
    const prisma = makePrisma([sub('m1', 'sub1')]);
    prisma.attendanceSession.findFirst.mockResolvedValue({
      id: 'sess3',
      workspaceId: 'w1',
      groupId: null,
      slotId: null,
      workspaceEventId: null,
      occurrenceKey: 'personal:r1',
      isPersonal: true,
      coachId: 'u1',
      startAt: new Date('2026-10-24T16:00:00Z'),
      timezone: 'Europe/Moscow',
    });
    prisma.personalTrainingRequest.findUnique.mockResolvedValue({
      memberId: 'm1',
      member: { firstname: 'Ann', lastname: null, email: 'm1@x' },
    });
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }]);
    // An override is ignored too: nothing is spent on a 1:1 session.
    await run(prisma, makeRbac(), 'sess3', ['m1'], [{ userId: 'm1', subscriptionId: 'sub1' }]);
    expect(prisma.attendanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(syncFirstVisitStartInTx).not.toHaveBeenCalled();
  });

  it('rejects marking anyone but the request member on a personal session', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue({
      id: 'sess3',
      workspaceId: 'w1',
      groupId: null,
      slotId: null,
      workspaceEventId: null,
      occurrenceKey: 'personal:r1',
      isPersonal: true,
      coachId: 'u1',
      startAt: new Date('2026-10-24T16:00:00Z'),
      timezone: 'Europe/Moscow',
    });
    prisma.personalTrainingRequest.findUnique.mockResolvedValue({
      memberId: 'm1',
    });
    await expect(
      run(prisma, makeRbac(), 'sess3', ['stranger']),
    ).rejects.toThrow(
      'На персональной тренировке можно отметить только ученика из заявки',
    );
    expect(prisma.attendanceRecord.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('rejects a non-ACTIVE / unknown userId', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'm2', firstname: 'Иван', lastname: 'Петров' },
    ]);
    await expect(
      run(prisma, makeRbac(), 'sess1', ['m1', 'm2']),
    ).rejects.toThrow('Не состоят в клубе: Иван Петров');
  });

  it('names members without a name instead of showing ids', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'm1', firstname: null, lastname: null },
    ]);
    await expect(
      run(prisma, makeRbac(), 'sess1', ['m1', 'm2']),
    ).rejects.toThrow('Не состоят в клубе: без имени, без имени');
  });

  it('allows the owner even without a member row', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([]); // owner not a member
    prisma.groupMember.findMany.mockResolvedValue([]);
    await run(prisma, makeRbac(), 'sess1', ['owner']);
    const rows = prisma.attendanceRecord.createManyAndReturn.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({
        userId: 'owner',
        isGuest: true,
        workspaceId: 'w1',
        sessionId: 'sess1',
        markedById: 'u1',
      }),
    ]);
  });

  it('computes isGuest against GroupMember', async () => {
    const prisma = groupPrisma([], ['m1', 'm2']);
    // m2 is a guest. user sub-object present for the buildRoster call that
    // runs after marking (the isGuest query only reads userId).
    prisma.groupMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        user: { firstname: null, lastname: null, email: 'm1@x' },
      },
    ]);
    await run(prisma, makeRbac(), 'sess1', ['m1', 'm2']);
    const rows = prisma.attendanceRecord.createManyAndReturn.mock.calls[0][0].data;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'm1', isGuest: false }),
        expect.objectContaining({ userId: 'm2', isGuest: true }),
      ]),
    );
  });

  it('event session marks isGuest null and uses skipDuplicates', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue({
      id: 'sess2',
      workspaceId: 'w1',
      groupId: null,
      slotId: null,
      workspaceEventId: 'e1',
      startAt: new Date('2026-10-24T16:00:00Z'),
    });
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }]);
    await run(prisma, makeRbac(), 'sess2', ['m1']);
    const call = prisma.attendanceRecord.createManyAndReturn.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0].isGuest).toBeNull();
  });

  it('loads the members’ abonements for the session’s club-calendar day', async () => {
    const prisma = groupPrisma([sub('m1', 'sub1')]);
    await run(prisma, makeRbac(), 'sess1', ['m1']);
    const args = prisma.subscription.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      workspaceId: 'w1',
      workspaceMember: { userId: { in: ['m1'] } },
      status: 'ACTIVE',
    });
    // 16:00Z is 19:00 in Moscow, the 24th.
    expect(args.select.freezes.where).toEqual({
      fromDate: { lte: new Date('2026-10-24T00:00:00Z') },
      untilDate: { gte: new Date('2026-10-24T00:00:00Z') },
    });
  });

  it('decrements the class pack and tags the visit with what it used and drew', async () => {
    const prisma = groupPrisma([sub('m1', 'sub1')]);
    const { realtime, followUps, leaderboard } = await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.subscription.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: { in: ['sub1'] }, classesRemaining: { gt: 0 } },
      data: { classesRemaining: { decrement: 1 } },
      select: { id: true, classesRemaining: true },
    });
    // One statement for the whole roster, so un-mark refunds this exact pack.
    expect(taggedRows(prisma)).toEqual([['m1', 'sub1', 'sub1']]);
    // Board cache dropped, club-wide refresh merged, the member's own views
    // refreshed on their room, pushes after commit.
    expect(leaderboard.invalidate).toHaveBeenCalledWith('w1');
    expect(realtime.invalidateCoalesced).toHaveBeenCalledWith('w1', [
      'attendance',
      'leaderboard',
    ]);
    expect(realtime.invalidateUsersInWorkspace).toHaveBeenCalledWith(
      ['m1'],
      'w1',
      ['attendance', 'subscription'],
    );
    expect(followUps.schedule).toHaveBeenCalledWith({
      workspaceId: 'w1',
      userIds: ['m1'],
      subscriptionIds: ['sub1'],
    });
  });

  it('draws the packs of the whole roster in one guarded statement', async () => {
    const prisma = groupPrisma(
      [sub('m1', 'sub1'), sub('m2', 'sub2')],
      ['m1', 'm2'],
    );
    await run(prisma, makeRbac(), 'sess1', ['m1', 'm2']);
    expect(prisma.subscription.updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.updateManyAndReturn.mock.calls[0][0].where.id.in).toEqual([
      'sub1',
      'sub2',
    ]);
    expect(taggedRows(prisma)).toEqual([
      ['m1', 'sub1', 'sub1'],
      ['m2', 'sub2', 'sub2'],
    ]);
  });

  it('counts a visit on a time-based abonement without deducting', async () => {
    const prisma = groupPrisma([
      sub('m1', 'time1', { classesTotal: null, classesRemaining: null }),
    ]);
    const { followUps } = await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(taggedRows(prisma)).toEqual([['m1', 'time1', null]]);
    expect(followUps.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionIds: [] }),
    );
  });

  it('falls through to the next pack when another check-in emptied the first meanwhile', async () => {
    const prisma = groupPrisma([
      sub('m1', 'bjj', { directions: ['bjj'] }),
      sub('m1', 'club'),
    ]);
    prisma.attendanceSession.findUnique = sessionIn('bjj');
    prisma.subscription.updateManyAndReturn
      .mockResolvedValueOnce([]) // the БЖЖ pack hit 0 meanwhile
      .mockResolvedValueOnce([{ id: 'club', classesRemaining: 4 }]);
    const { followUps } = await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(
      prisma.subscription.updateManyAndReturn.mock.calls.map((c: any) => c[0].where.id.in),
    ).toEqual([['bjj'], ['club']]);
    expect(taggedRows(prisma)).toEqual([['m1', 'club', 'club']]);
    expect(followUps.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionIds: ['club'] }),
    );
  });

  it('leaves the visit unattributed when its only pack was emptied meanwhile', async () => {
    const prisma = groupPrisma([sub('m1', 'sub1', { classesRemaining: 1 })]);
    // The guarded decrement found classesRemaining already at 0.
    prisma.subscription.updateManyAndReturn.mockResolvedValue([]);
    const { followUps } = await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(followUps.schedule).toHaveBeenCalledWith({
      workspaceId: 'w1',
      userIds: ['m1'],
      subscriptionIds: [],
    });
  });

  it.each([
    ['an expired pack', { endDate: new Date(Date.now() - 24 * 3600 * 1000) }],
    ['a cancelled pack', { status: 'CANCELLED' }],
    ['an exhausted pack', { classesRemaining: 0 }],
  ])('records the visit but spends nothing from %s', async (_name, over) => {
    const prisma = groupPrisma([sub('m1', 'sub1', over)]);
    await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.attendanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not consume a class on a re-mark (already present)', async () => {
    const prisma = groupPrisma([sub('m1', 'sub1')]);
    // m1 is already marked (by a coach, or a self check-in that won the
    // race): the insert returns nothing → not a new mark → no decrement.
    prisma.attendanceRecord.createManyAndReturn.mockResolvedValue([]);
    const { realtime, followUps, leaderboard } = await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(followUps.schedule).not.toHaveBeenCalled();
    expect(leaderboard.invalidate).not.toHaveBeenCalled();
    expect(realtime.invalidateCoalesced).not.toHaveBeenCalled();
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  describe('several abonements and directions', () => {
    const multi = sub('m1', 'bjj-mma', { directions: ['bjj', 'mma'] });

    it.each([['bjj'], ['mma']])('a БЖЖ+ММА pack is drawn by a %s class', async (d) => {
      const prisma = groupPrisma([multi]);
      prisma.attendanceSession.findUnique = sessionIn(d);
      await run(prisma, makeRbac(), 'sess1', ['m1']);
      expect(taggedRows(prisma)).toEqual([['m1', 'bjj-mma', 'bjj-mma']]);
    });

    it('a БЖЖ+ММА pack is not drawn by a Muay Thai class', async () => {
      const prisma = groupPrisma([multi]);
      prisma.attendanceSession.findUnique = sessionIn('muay-thai');
      await run(prisma, makeRbac(), 'sess1', ['m1']);
      expect(prisma.attendanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('a БЖЖ-only pack beats a club-wide one at a БЖЖ class', async () => {
      const prisma = groupPrisma([
        // Older sale and ending sooner: precedence is scope first.
        sub('m1', 'club', { createdAt: new Date('2026-01-01T00:00:00Z') }),
        sub('m1', 'bjj', { directions: ['bjj'] }),
      ]);
      prisma.attendanceSession.findUnique = sessionIn('bjj');
      await run(prisma, makeRbac(), 'sess1', ['m1']);
      expect(taggedRows(prisma)).toEqual([['m1', 'bjj', 'bjj']]);
    });

    it('a class without a direction uses only the club-wide one', async () => {
      const prisma = groupPrisma([
        sub('m1', 'bjj', { directions: ['bjj'] }),
        sub('m1', 'club', { classesTotal: null, classesRemaining: null }),
      ]);
      prisma.attendanceSession.findUnique = sessionIn(null);
      await run(prisma, makeRbac(), 'sess1', ['m1']);
      expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
      expect(taggedRows(prisma)).toEqual([['m1', 'club', null]]);
    });

    it('skips a frozen abonement and uses the other one', async () => {
      const prisma = groupPrisma([
        sub('m1', 'bjj', { directions: ['bjj'], frozen: true }),
        sub('m1', 'club'),
      ]);
      prisma.attendanceSession.findUnique = sessionIn('bjj');
      await run(prisma, makeRbac(), 'sess1', ['m1']);
      expect(taggedRows(prisma)).toEqual([['m1', 'club', 'club']]);
    });

    it('looks the session direction up only when a scoped abonement is in play', async () => {
      const prisma = groupPrisma([sub('m1', 'club')]);
      await run(prisma, makeRbac(), 'sess1', ['m1']);
      expect(prisma.attendanceSession.findUnique).not.toHaveBeenCalled();
      expect(prisma.subscription.updateManyAndReturn).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-member abonement override', () => {
    const subs = [
      sub('m1', 'bjj', { directions: ['bjj'] }),
      sub('m1', 'club', { classesTotal: null, classesRemaining: null }),
      sub('m1', 'mma', { directions: ['mma'] }),
    ];

    it('spends the visit on the chosen eligible abonement', async () => {
      const prisma = groupPrisma(subs);
      prisma.attendanceSession.findUnique = sessionIn('bjj');
      await run(prisma, makeRbac(), 'sess1', ['m1'], [{ userId: 'm1', subscriptionId: 'club' }]);
      expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
      expect(taggedRows(prisma)).toEqual([['m1', 'club', null]]);
    });

    it.each([
      ['an abonement that does not cover the class', 'm1', 'mma'],
      ['an unknown abonement', 'm1', 'other'],
      ['a member who is not being marked', 'm2', 'club'],
    ])('refuses %s before writing anything', async (_name, userId, subscriptionId) => {
      const prisma = groupPrisma(subs);
      prisma.attendanceSession.findUnique = sessionIn('bjj');
      const res = run(prisma, makeRbac(), 'sess1', ['m1'], [{ userId, subscriptionId }]);
      await expect(res).rejects.toBeInstanceOf(BadRequestError);
      await expect(res).rejects.toThrow('Этот абонемент нельзя списать на эту тренировку');
      expect(prisma.attendanceRecord.createManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('refuses a frozen abonement', async () => {
      const prisma = groupPrisma([
        sub('m1', 'bjj', { directions: ['bjj'], frozen: true }),
        sub('m1', 'club'),
      ]);
      prisma.attendanceSession.findUnique = sessionIn('bjj');
      await expect(
        run(prisma, makeRbac(), 'sess1', ['m1'], [{ userId: 'm1', subscriptionId: 'bjj' }]),
      ).rejects.toThrow('Этот абонемент нельзя списать на эту тренировку');
    });
  });

  it('re-derives first-visit starts only for members holding such an abonement', async () => {
    const prisma = groupPrisma(
      [
        sub('m1', 'sub1', { classesTotal: null, classesRemaining: null, endDate: null, startsOnFirstVisit: true }),
        sub('m2', 'sub2', { classesTotal: null, classesRemaining: null, endDate: null }),
      ],
      ['m1', 'm2'],
    );
    await run(prisma, makeRbac(), 'sess1', ['m1', 'm2']);
    expect(syncFirstVisitStartInTx).toHaveBeenCalledTimes(1);
    expect(syncFirstVisitStartInTx).toHaveBeenCalledWith(prisma, {
      workspaceId: 'w1',
      userId: 'm1',
      now: expect.any(Date),
    });
  });
});

describe('markRecords — lastAttendedAt', () => {
  it('refreshes lastAttendedAt for everyone marked, after the write', async () => {
    const prisma = groupPrisma([], ['m1', 'm2']);
    (syncLastAttendedAt as jest.Mock).mockClear();
    await run(prisma, makeRbac(), 'sess1', ['m1', 'm2']);
    expect(syncLastAttendedAt).toHaveBeenCalledWith(prisma, 'w1', ['m1', 'm2']);
  });
});
