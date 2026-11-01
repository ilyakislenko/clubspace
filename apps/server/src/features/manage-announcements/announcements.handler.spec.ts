import { CreateAnnouncementFeature } from './create-announcement.feature';
import { CreateAnnouncementHandler } from './create-announcement.handler';
import { GetAnnouncementFeedFeature } from './get-feed.feature';
import { GetAnnouncementFeedHandler } from './get-feed.handler';
import { ListAnnouncementsFeature } from './list-announcements.feature';
import { ListAnnouncementsHandler } from './list-announcements.handler';
import { announcementMemberWhere, announceToWorkspace } from './notify';
import { expiringSegmentWhere } from './renewal-segment';
import { UpdateAnnouncementFeature } from './update-announcement.feature';
import { UpdateAnnouncementHandler } from './update-announcement.handler';
import { NotFoundError } from '../../shared/errors/shared.errors';

const BJJ = '11111111-1111-4111-8111-111111111111';
const MMA = '22222222-2222-4222-8222-222222222222';
const bjjRef = { id: BJJ, name: 'БЖЖ', color: '#00f', icon: null };

const rbac = (admin = true) => ({
  resolveCoachScope: jest
    .fn()
    .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
  canWriteAllGroups: jest.fn().mockReturnValue(admin),
});

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Closed Friday',
  body: 'Gym closed',
  pinned: false,
  audience: 'ALL',
  directionId: null,
  direction: null,
  publishedAt: null,
  author: { firstname: 'Coach', lastname: null, email: 'c@x' },
  createdAt: new Date('2026-07-04T00:00:00Z'),
  updatedAt: new Date('2026-07-04T00:00:00Z'),
  ...over,
});

describe('createAnnouncement', () => {
  it('publishes immediately when publish=true', async () => {
    const prisma = {
      announcement: {
        create: jest
          .fn()
          .mockResolvedValue(row({ publishedAt: new Date('2026-07-04Z') })),
      },
    };
    await new CreateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace: jest.fn() } as never,
      { invalidate: jest.fn(), emitListDelta: jest.fn() } as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B', publish: true },
        'w1',
        'u1',
        'admin',
        false,
      ),
    );
    expect(
      prisma.announcement.create.mock.calls[0][0].data.publishedAt,
    ).toBeInstanceOf(Date);
  });

  it('leaves a draft (publishedAt null) when publish is absent', async () => {
    const prisma = {
      announcement: { create: jest.fn().mockResolvedValue(row()) },
    };
    const out = await new CreateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace: jest.fn() } as never,
      { invalidate: jest.fn(), emitListDelta: jest.fn() } as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B' },
        'w1',
        'u1',
        'admin',
        false,
      ),
    );
    expect(
      prisma.announcement.create.mock.calls[0][0].data.publishedAt,
    ).toBeNull();
    expect(out.publishedAt).toBeNull();
    expect(out.authorName).toBe('Coach');
  });

  it('forbids a non-admin', async () => {
    const prisma = { announcement: { create: jest.fn() } };
    await expect(
      new CreateAnnouncementHandler(
        prisma as never,
        rbac(false) as never,
        { notifyWorkspace: jest.fn() } as never,
        { invalidate: jest.fn(), emitListDelta: jest.fn() } as never,
      ).execute(
        new CreateAnnouncementFeature(
          { title: 'T', body: 'B' },
          'w1',
          'u1',
          'coach',
          false,
        ),
      ),
    ).rejects.toThrow(/администратор/i);
    expect(prisma.announcement.create).not.toHaveBeenCalled();
  });
});

describe('getAnnouncementFeed', () => {
  it('returns only live announcements (publishedAt <= now), pinned-first', async () => {
    const prisma = {
      announcement: {
        findMany: jest
          .fn()
          .mockResolvedValue([row({ publishedAt: new Date('2026-07-04Z') })]),
        count: jest.fn().mockResolvedValue(1),
      },
      workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }),
      },
      groupMember: { findMany: jest.fn().mockResolvedValue([]) },
      groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const out = await new GetAnnouncementFeedHandler(prisma as never).execute(
      new GetAnnouncementFeedFeature({}, 'w1', 'u1'),
    );
    const call = prisma.announcement.findMany.mock.calls[0][0];
    // Scheduled-for-later (future publishedAt) and drafts (null) stay hidden.
    expect(call.where.workspaceId).toBe('w1');
    expect(call.where.publishedAt.lte).toBeInstanceOf(Date);
    expect(call.orderBy).toEqual([{ pinned: 'desc' }, { publishedAt: 'desc' }]);
    expect(out.total).toBe(1);
    expect(out.data[0]).toMatchObject({ id: 'a1', authorName: 'Coach' });
  });

  it('does not notify or feed-delta a scheduled (future) announcement', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const notifyWorkspace = jest.fn();
    const emitListDelta = jest.fn();
    const prisma = {
      announcement: {
        create: jest.fn().mockResolvedValue(
          row({ publishedAt: new Date(future) }),
        ),
      },
    };
    await new CreateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace } as never,
      { invalidate: jest.fn(), emitListDelta } as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B', publishAt: future },
        'w1',
        'u1',
        'admin',
        false,
      ),
    );
    expect(notifyWorkspace).not.toHaveBeenCalled();
    expect(emitListDelta).not.toHaveBeenCalled();
  });
});

describe('announcements by direction', () => {
  const realtime = () => ({ invalidate: jest.fn(), emitListDelta: jest.fn() });

  it('create: validates the direction, stores it and refetches feeds instead of a delta', async () => {
    const live = row({
      publishedAt: new Date('2026-07-04Z'),
      directionId: BJJ,
      direction: bjjRef,
    });
    const prisma = {
      announcement: { create: jest.fn().mockResolvedValue(live) },
      direction: { findFirst: jest.fn().mockResolvedValue({ id: BJJ }) },
    };
    const rt = realtime();
    const notifyWorkspace = jest.fn();
    const out = await new CreateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace } as never,
      rt as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B', publish: true, directionId: BJJ },
        'w1',
        'u1',
        'admin',
        false,
      ),
    );
    const call = prisma.announcement.create.mock.calls[0][0];
    expect(call.data.directionId).toBe(BJJ);
    expect(call.include.direction).toBeDefined();
    expect(out.direction).toEqual(bjjRef);
    expect(rt.emitListDelta).not.toHaveBeenCalled();
    expect(rt.invalidate).toHaveBeenCalledWith('w1', ['announcements']);
    expect(notifyWorkspace.mock.calls[0][0].memberWhere).toEqual(
      announcementMemberWhere({ audience: 'ALL', directionId: BJJ }),
    );
  });

  it('create: a club-wide live announcement keeps the list delta', async () => {
    const prisma = {
      announcement: {
        create: jest
          .fn()
          .mockResolvedValue(row({ publishedAt: new Date('2026-07-04Z') })),
      },
    };
    const rt = realtime();
    const out = await new CreateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace: jest.fn() } as never,
      rt as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B', publish: true },
        'w1',
        'u1',
        'admin',
        false,
      ),
    );
    expect(out.direction).toBeNull();
    expect(rt.emitListDelta).toHaveBeenCalledWith(
      'w1',
      'announcements',
      'create',
      out,
    );
    expect(rt.invalidate).not.toHaveBeenCalled();
  });

  it('create: 404s a direction of another club', async () => {
    const prisma = {
      announcement: { create: jest.fn() },
      direction: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    await expect(
      new CreateAnnouncementHandler(
        prisma as never,
        rbac() as never,
        { notifyWorkspace: jest.fn() } as never,
        realtime() as never,
      ).execute(
        new CreateAnnouncementFeature(
          { title: 'T', body: 'B', directionId: MMA },
          'w1',
          'u1',
          'admin',
          false,
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.announcement.create).not.toHaveBeenCalled();
  });

  const runUpdate = (
    existing: { publishedAt: Date | null; directionId: string | null },
    updated: ReturnType<typeof row>,
    payload: Record<string, unknown>,
    directionFound = true,
  ) => {
    const prisma = {
      announcement: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1', ...existing }),
        update: jest.fn().mockResolvedValue(updated),
      },
      direction: {
        findFirst: jest
          .fn()
          .mockResolvedValue(directionFound ? { id: BJJ } : null),
      },
    };
    const rt = realtime();
    const notifyWorkspace = jest.fn();
    const promise = new UpdateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace } as never,
      rt as never,
    ).execute(
      new UpdateAnnouncementFeature(payload, 'w1', 'a1', 'u1', 'admin', false),
    );
    return { promise, prisma, rt, notifyWorkspace };
  };

  it('update: moving a live club-wide announcement to a direction refetches feeds', async () => {
    const live = new Date('2026-07-04Z');
    const { promise, prisma, rt } = runUpdate(
      { publishedAt: live, directionId: null },
      row({ publishedAt: live, directionId: BJJ, direction: bjjRef }),
      { directionId: BJJ },
    );
    const out = await promise;
    expect(prisma.announcement.update.mock.calls[0][0].data).toEqual({
      directionId: BJJ,
    });
    expect(out.direction).toEqual(bjjRef);
    expect(rt.invalidate).toHaveBeenCalledWith('w1', ['announcements']);
    expect(rt.emitListDelta).not.toHaveBeenCalled();
  });

  it('update: publishing a direction draft notifies its members and refetches feeds', async () => {
    const { promise, rt, notifyWorkspace } = runUpdate(
      { publishedAt: null, directionId: BJJ },
      row({
        publishedAt: new Date('2026-07-04Z'),
        directionId: BJJ,
        direction: bjjRef,
      }),
      { publish: true },
    );
    await promise;
    expect(notifyWorkspace).toHaveBeenCalledTimes(1);
    expect(rt.invalidate).toHaveBeenCalledWith('w1', ['announcements']);
    expect(rt.emitListDelta).not.toHaveBeenCalled();
  });

  it('update: a club-wide live edit keeps the update delta, back to club-wide clears the direction', async () => {
    const live = new Date('2026-07-04Z');
    const { promise, prisma, rt } = runUpdate(
      { publishedAt: live, directionId: null },
      row({ publishedAt: live, title: 'New' }),
      { title: 'New', directionId: null },
    );
    await promise;
    expect(prisma.announcement.update.mock.calls[0][0].data).toEqual({
      title: 'New',
      directionId: null,
    });
    expect(prisma.direction.findFirst).not.toHaveBeenCalled();
    expect(rt.emitListDelta).toHaveBeenCalledWith(
      'w1',
      'announcements',
      'update',
      expect.objectContaining({ title: 'New' }),
    );
  });

  it('update: 404s a foreign direction without writing', async () => {
    const { promise, prisma } = runUpdate(
      { publishedAt: null, directionId: null },
      row(),
      { directionId: MMA },
      false,
    );
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });

  const feedPrisma = (over: {
    role?: string | null;
    ownerId?: string;
    memberOf?: string[];
  }) => ({
    announcement: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(
        over.role === undefined
          ? null
          : {
              accessUntil: null,
              role: over.role ? { name: over.role } : null,
              subscription: null,
            },
      ),
    },
    workspace: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ ownerId: over.ownerId ?? 'owner' }),
    },
    groupMember: {
      findMany: jest.fn().mockResolvedValue(
        (over.memberOf ?? []).map((directionId) => ({ group: { directionId } })),
      ),
    },
    groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
  });
  const feed = async (prisma: ReturnType<typeof feedPrisma>, userId = 'u1') => {
    await new GetAnnouncementFeedHandler(prisma as never).execute(
      new GetAnnouncementFeedFeature({}, 'w1', userId),
    );
    return prisma.announcement.findMany.mock.calls[0][0].where;
  };

  it('feed: a student sees club-wide + own directions only (another direction hidden)', async () => {
    const prisma = feedPrisma({ role: 'user', memberOf: [BJJ] });
    const where = await feed(prisma);
    expect(where.OR).toEqual([
      { directionId: null },
      { directionId: { in: [BJJ] } },
    ]);
    // An MMA announcement matches neither branch.
    expect(where.OR[1].directionId.in).not.toContain(MMA);
    expect(prisma.announcement.count.mock.calls[0][0].where).toEqual(where);
  });

  it('feed: a student in no direction sees only club-wide ones', async () => {
    const where = await feed(feedPrisma({ role: 'user' }));
    expect(where.OR).toEqual([
      { directionId: null },
      { directionId: { in: [] } },
    ]);
  });

  it('feed: staff see every direction', async () => {
    const prisma = feedPrisma({ role: 'coach' });
    const where = await feed(prisma);
    expect(where).not.toHaveProperty('OR');
    expect(prisma.groupMember.findMany).not.toHaveBeenCalled();
  });

  it('feed: the owner (no member row) sees every direction', async () => {
    const where = await feed(feedPrisma({ ownerId: 'boss' }), 'boss');
    expect(where).not.toHaveProperty('OR');
  });

  it('list: filters by direction when asked', async () => {
    const prisma = {
      announcement: {
        findMany: jest.fn().mockResolvedValue([row({ directionId: BJJ, direction: bjjRef })]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const handler = new ListAnnouncementsHandler(prisma as never, rbac() as never);
    const out = await handler.execute(
      new ListAnnouncementsFeature({ directionId: BJJ }, 'w1', 'u1', 'admin', false),
    );
    expect(prisma.announcement.findMany.mock.calls[0][0].where).toEqual({
      workspaceId: 'w1',
      directionId: BJJ,
    });
    expect(out.data[0].direction).toEqual(bjjRef);
    await handler.execute(
      new ListAnnouncementsFeature({}, 'w1', 'u1', 'admin', false),
    );
    expect(prisma.announcement.findMany.mock.calls[1][0].where).toEqual({
      workspaceId: 'w1',
    });
  });
});

describe('announcementMemberWhere', () => {
  const staff = { role: { name: { in: ['admin', 'head_coach', 'coach'] } } };
  const ofBjj = {
    user: {
      OR: [
        { groupMemberships: { some: { group: { directionId: BJJ } } } },
        { coachAssignments: { some: { group: { directionId: BJJ } } } },
      ],
    },
  };

  it('is unrestricted for a club-wide ALL announcement', () => {
    expect(
      announcementMemberWhere({ audience: 'ALL', directionId: null }),
    ).toBeUndefined();
  });

  it('keeps the renewal segment alone for a club-wide EXPIRING one', () => {
    expect(
      announcementMemberWhere({ audience: 'EXPIRING', directionId: null }),
    ).toEqual(expiringSegmentWhere());
  });

  it('targets direction members or staff', () => {
    expect(
      announcementMemberWhere({ audience: 'ALL', directionId: BJJ }),
    ).toEqual({ OR: [ofBjj, staff] });
  });

  it('ANDs the direction with the renewal segment', () => {
    const w = announcementMemberWhere({ audience: 'EXPIRING', directionId: BJJ });
    expect(w).toEqual({
      AND: [{ OR: [ofBjj, staff] }, expect.objectContaining({ OR: expect.any(Array) })],
    });
  });

  it('passes the filter to the fan-out', async () => {
    const notifyWorkspace = jest.fn();
    await announceToWorkspace({ notifyWorkspace } as never, {
      id: 'a1',
      workspaceId: 'w1',
      title: 'T',
      body: 'B',
      authorId: 'u1',
      audience: 'ALL',
      directionId: BJJ,
    });
    expect(notifyWorkspace.mock.calls[0][0].memberWhere).toEqual({
      OR: [ofBjj, staff],
    });
    notifyWorkspace.mockClear();
    await announceToWorkspace({ notifyWorkspace } as never, {
      id: 'a2',
      workspaceId: 'w1',
      title: 'T',
      body: 'B',
      authorId: 'u1',
      audience: 'ALL',
      directionId: null,
    });
    expect(notifyWorkspace.mock.calls[0][0]).not.toHaveProperty('memberWhere');
  });
});
