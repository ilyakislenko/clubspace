import { MarkRecordsFeature } from './mark-records.feature';
import { MarkRecordsHandler } from './mark-records.handler';

const makePrisma = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = {
    attendanceSession: { findFirst: jest.fn() },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }),
    },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    groupMember: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscription: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
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
});

const run = (prisma: any, rbac: any, sessionId: string, userIds: string[]) =>
  new MarkRecordsHandler(prisma, rbac, {
    invalidate: jest.fn(),
  } as never).execute(
    new MarkRecordsFeature({ userIds }, 'w1', sessionId, 'u1', 'admin', false),
  );

const groupSession = {
  id: 'sess1',
  workspaceId: 'w1',
  groupId: 'g1',
  slotId: 's1',
  workspaceEventId: null,
};

describe('markRecords', () => {
  it('rejects a non-ACTIVE / unknown userId', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }]);
    await expect(
      run(prisma, makeRbac(), 'sess1', ['m1', 'm2']),
    ).rejects.toThrow(/m2/);
  });

  it('allows the owner even without a member row', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([]); // owner not a member
    prisma.groupMember.findMany.mockResolvedValue([]);
    await run(prisma, makeRbac(), 'sess1', ['owner']);
    const rows = prisma.attendanceRecord.createMany.mock.calls[0][0].data;
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
    const rows = prisma.attendanceRecord.createMany.mock.calls[0][0].data;
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
    const call = prisma.attendanceRecord.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0].isGuest).toBeNull();
  });

  it('decrements the class-pack of newly-marked members', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      { userId: 'm1', subscriptionId: 'sub1' },
    ]);
    await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub1'] }, classesRemaining: { gt: 0 } },
      data: { classesRemaining: { decrement: 1 } },
    });
  });

  it('does not consume a class on a re-mark (already present)', async () => {
    const prisma = makePrisma();
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession);
    prisma.workspaceMember.findMany.mockResolvedValue([
      { userId: 'm1', subscriptionId: 'sub1' },
    ]);
    // m1 is already marked → not a new mark → no decrement.
    prisma.attendanceRecord.findMany.mockResolvedValue([{ userId: 'm1' }]);
    await run(prisma, makeRbac(), 'sess1', ['m1']);
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });
});
