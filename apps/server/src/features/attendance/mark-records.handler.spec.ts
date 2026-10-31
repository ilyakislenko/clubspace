import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start';
import { MarkRecordsFeature } from './mark-records.feature';
import { MarkRecordsHandler } from './mark-records.handler';

jest.mock('../../domains/subscriptions/first-visit-start', () => ({
  syncFirstVisitStartInTx: jest.fn().mockResolvedValue('unchanged'),
}));

beforeEach(() => (syncFirstVisitStartInTx as jest.Mock).mockClear());

const makePrisma = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = {
    attendanceSession: { findFirst: jest.fn() },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }),
    },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    groupMember: { findMany: jest.fn().mockResolvedValue([]) },
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
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
          where.id.in.map((id) => ({ id })),
      ),
      findMany: jest.fn().mockResolvedValue([]),
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
    new MarkRecordsFeature({ userIds }, 'w1', sessionId, 'u1', 'admin', false),
  );
  return { out, realtime, followUps, leaderboard };
};

// The raw tagging statement, flattened so tests can look for its values.
const taggedSql = (prisma: any) =>
  JSON.stringify(prisma.$executeRaw.mock.calls[0]);

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

describe('markRecords', () => {
  it('records a personal session but never draws a class pack', async () => {
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
      member: { firstname: 'Ann', lastname: null, email: 'm1@x' },
    });
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        subscription: {
          id: 'sub1',
          classesRemaining: 3,
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 24 * 3600 * 1000),
        },
      },
    ]);
    await run(prisma, makeRbac(), 'sess3', ['m1']);
    expect(prisma.attendanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
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
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      { userId: 'm1' },
      { userId: 'm2' },
    ]);
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
    });
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }]);
    await run(prisma, makeRbac(), 'sess2', ['m1']);
    const call = prisma.attendanceRecord.createManyAndReturn.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0].isGuest).toBeNull();
  });

  it('decrements the class-pack and tags the check-in with the pack it drew from', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        subscription: {
          id: 'sub1',
          classesRemaining: 5,
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      },
    ]);
    const { realtime, followUps, leaderboard } = await run(
      prisma,
      makeRbac(),
      'sess1',
      ['m1'],
    );
    expect(prisma.subscription.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: { in: ['sub1'] }, classesRemaining: { gt: 0 } },
      data: { classesRemaining: { decrement: 1 } },
      select: { id: true },
    });
    // The consumed check-in is tagged (one statement for the whole roster)
    // so un-mark refunds this exact pack.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(taggedSql(prisma)).toContain('"m1"');
    expect(taggedSql(prisma)).toContain('"sub1"');
    expect(taggedSql(prisma)).toContain('"sess1"');
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

  it('does not tag a pack another check-in emptied in the meantime', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        subscription: {
          id: 'sub1',
          classesRemaining: 1,
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      },
    ]);
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

  // The membership keeps pointing at a pack after it dies, so these used to
  // burn a class the member could never spend.
  it('does not consume from an expired pack', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        subscription: {
          id: 'sub1',
          classesRemaining: 5,
          status: 'ACTIVE',
          endDate: new Date(Date.now() - 24 * 3600 * 1000),
        },
      },
    ]);
    await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not consume from a cancelled pack', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        subscription: {
          id: 'sub1',
          classesRemaining: 5,
          status: 'CANCELLED',
          endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      },
    ]);
    await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('does not consume (or tag) when the pack is already exhausted', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        subscription: {
          id: 'sub1',
          classesRemaining: 0,
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      },
    ]);
    await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('skips a time-only subscription (classesRemaining null)', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      { userId: 'm1', subscription: { id: 'sub1', classesRemaining: null } },
    ]);
    await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not consume a class on a re-mark (already present)', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        subscription: {
          id: 'sub1',
          classesRemaining: 5,
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      },
    ]);
    // m1 is already marked (by a coach, or a self check-in that won the
    // race): the insert returns nothing → not a new mark → no decrement.
    prisma.attendanceRecord.createManyAndReturn.mockResolvedValue([]);
    const { realtime, followUps, leaderboard } = await run(
      prisma,
      makeRbac(),
      'sess1',
      ['m1'],
    );
    expect(followUps.schedule).not.toHaveBeenCalled();
    expect(leaderboard.invalidate).not.toHaveBeenCalled();
    expect(realtime.invalidateCoalesced).not.toHaveBeenCalled();
    expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('starts a first-visit abonement from the mark (only for members whose pack waits)', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        userId: 'm1',
        subscription: {
          id: 'sub1',
          classesRemaining: null,
          startsOnFirstVisit: true,
          status: 'ACTIVE',
          endDate: null,
        },
      },
      {
        userId: 'm2',
        subscription: {
          id: 'sub2',
          classesRemaining: null,
          startsOnFirstVisit: false,
          status: 'ACTIVE',
          endDate: null,
        },
      },
    ]);
    await run(prisma, makeRbac(), 'sess1', ['m1', 'm2']);
    expect(syncFirstVisitStartInTx).toHaveBeenCalledTimes(1);
    expect(syncFirstVisitStartInTx).toHaveBeenCalledWith(prisma, {
      workspaceId: 'w1',
      userId: 'm1',
      now: expect.any(Date),
    });
  });
});
