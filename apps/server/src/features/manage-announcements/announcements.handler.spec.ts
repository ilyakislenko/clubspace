import { CreateAnnouncementFeature } from './create-announcement.feature';
import { CreateAnnouncementHandler } from './create-announcement.handler';
import { DeleteAnnouncementFeature } from './delete-announcement.feature';
import { DeleteAnnouncementHandler } from './delete-announcement.handler';
import { GetAnnouncementFeedFeature } from './get-feed.feature';
import { GetAnnouncementFeedHandler } from './get-feed.handler';
import { ListAnnouncementsFeature } from './list-announcements.feature';
import { ListAnnouncementsHandler } from './list-announcements.handler';
import { announcementMemberWhere, announceToWorkspace } from './notify';
import { ownedByDirectionsWhere, visibleToMemberWhere } from './target';
import { expiringSegmentWhere } from './renewal-segment';
import { UpdateAnnouncementFeature } from './update-announcement.feature';
import { UpdateAnnouncementHandler } from './update-announcement.handler';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors/shared.errors';

const BJJ = '11111111-1111-4111-8111-111111111111';
const MMA = '22222222-2222-4222-8222-222222222222';
const bjjRef = { id: BJJ, name: 'БЖЖ', color: '#00f', icon: null };

const rbac = (admin = true, managed: string[] = []) => ({
  resolveCoachScope: jest
    .fn()
    .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
  canWriteAllGroups: jest.fn().mockReturnValue(admin),
  // Mirrors RbacService: admin passes; else every named direction must be
  // managed, null (club-wide) or nothing named is refused.
  assertCanManageDirection: jest.fn(
    async (_ctx: unknown, ...ids: Array<string | null | undefined>) => {
      if (admin) return
      const named = ids.filter((d) => d !== undefined)
      if (
        named.length === 0 ||
        named.some((d) => d === null || !managed.includes(d))
      ) {
        throw new ForbiddenError({
          message: 'Нужны права администратора клуба',
        })
      }
    },
  ),
  assertManagesDirections: jest.fn(async () => {
    if (admin) return null
    if (managed.length === 0) {
      throw new ForbiddenError({
        message: 'Нужны права администратора клуба',
      })
    }
    return managed
  }),
});

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Closed Friday',
  body: 'Gym closed',
  pinned: false,
  audience: 'ALL',
  directionId: null,
  direction: null,
  groups: [] as unknown[],
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

  // The renewal segment over several current abonements at once.
  const segmentFeed = async (member: unknown) => {
    const prisma = {
      announcement: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      workspaceMember: { findFirst: jest.fn().mockResolvedValue(member) },
      workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }) },
      groupMember: { findMany: jest.fn().mockResolvedValue([]) },
      groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await new GetAnnouncementFeedHandler(prisma as never).execute(
      new GetAnnouncementFeedFeature({}, 'w1', 'u1'),
    );
    return {
      select: prisma.workspaceMember.findFirst.mock.calls[0][0].select,
      where: prisma.announcement.findMany.mock.calls[0][0].where,
    };
  };
  const started = new Date('2026-07-01Z');

  it('reads only the current abonements of the member', async () => {
    const { select } = await segmentFeed(null);
    expect(select.subscriptions.where).toEqual({
      NOT: { workspaceMemberId: null },
      status: 'ACTIVE',
      OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
    });
  });

  it('a member is due for renewal when any current pack is on its last class', async () => {
    const { where } = await segmentFeed({
      accessUntil: new Date(Date.now() + 60 * 86_400_000),
      role: { name: 'user' },
      subscriptions: [
        { classesRemaining: 10, status: 'ACTIVE', startDate: started },
        { classesRemaining: 1, status: 'ACTIVE', startDate: started },
      ],
    });
    expect(where).not.toHaveProperty('audience');
  });

  it('a lapsing window is not "expiring" while any abonement awaits its first visit', async () => {
    const { where } = await segmentFeed({
      accessUntil: new Date(Date.now() + 2 * 86_400_000),
      role: { name: 'user' },
      subscriptions: [
        { classesRemaining: null, status: 'ACTIVE', startDate: started },
        { classesRemaining: null, status: 'ACTIVE', startDate: null },
      ],
    });
    expect(where.audience).toBe('ALL');
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
      announcementMemberWhere({ audience: 'ALL', directionId: BJJ, groups: [] }),
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
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'a1', groups: [], ...existing }),
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
      groups: { deleteMany: {}, create: [] },
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
      groups: { deleteMany: {}, create: [] },
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
    inGroups?: string[];
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
              subscriptions: [],
            },
      ),
    },
    workspace: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ ownerId: over.ownerId ?? 'owner' }),
    },
    groupMember: {
      // One query reads directions, the other group ids: answer both.
      findMany: jest.fn().mockResolvedValue([
        ...(over.memberOf ?? []).map((directionId) => ({
          groupId: `g-${directionId}`,
          group: { directionId },
        })),
        ...(over.inGroups ?? []).map((groupId) => ({
          groupId,
          group: { directionId: null },
        })),
      ]),
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
      { directionId: null, groups: { none: {} } },
      { directionId: { in: [BJJ] } },
      { groups: { some: { groupId: { in: [`g-${BJJ}`] } } } },
    ]);
    // An MMA announcement matches neither branch.
    expect(where.OR[1].directionId.in).not.toContain(MMA);
    expect(prisma.announcement.count.mock.calls[0][0].where).toEqual(where);
  });

  it('feed: a student in no direction sees only club-wide ones', async () => {
    const where = await feed(feedPrisma({ role: 'user' }));
    expect(where.OR).toEqual(
      visibleToMemberWhere({ directionIds: [], groupIds: [] }).OR,
    );
  });

  it('feed: a student sees announcements of the groups they train in', async () => {
    const where = await feed(feedPrisma({ role: 'user', inGroups: ['kids'] }));
    expect(where.OR).toContainEqual({
      groups: { some: { groupId: { in: ['kids'] } } },
    });
    // Club-wide = no direction and no target groups.
    expect(where.OR[0]).toEqual({ directionId: null, groups: { none: {} } });
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
      ...ownedByDirectionsWhere([BJJ]),
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
      announcementMemberWhere({ audience: 'ALL', directionId: null, groups: [] }),
    ).toBeUndefined();
  });

  it('keeps the renewal segment alone for a club-wide EXPIRING one', () => {
    expect(
      announcementMemberWhere({ audience: 'EXPIRING', directionId: null, groups: [] }),
    ).toEqual(expiringSegmentWhere());
  });

  it('targets direction members or staff', () => {
    expect(
      announcementMemberWhere({ audience: 'ALL', directionId: BJJ, groups: [] }),
    ).toEqual({ OR: [ofBjj, staff] });
  });

  it('ANDs the direction with the renewal segment', () => {
    const w = announcementMemberWhere({ audience: 'EXPIRING', directionId: BJJ, groups: [] });
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
      groups: [],
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
      groups: [],
    });
    expect(notifyWorkspace.mock.calls[0][0]).not.toHaveProperty('memberWhere');
  });

  it('targets students and coaches of the groups or staff; a deleted group matches nobody', () => {
    const ids = { in: ['g1'] };
    expect(
      announcementMemberWhere({
        audience: 'ALL',
        directionId: null,
        groups: [{ groupId: 'g1' }, { groupId: null }],
      }),
    ).toEqual({
      OR: [
        {
          user: {
            OR: [
              { groupMemberships: { some: { groupId: ids } } },
              { coachAssignments: { some: { groupId: ids } } },
            ],
          },
        },
        staff,
      ],
    });
  });
});

describe('announcements as a direction manager', () => {
  const deps = () => ({
    prisma: {
      announcement: {
        create: jest.fn().mockResolvedValue(row({ directionId: BJJ, direction: bjjRef })),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'a1', publishedAt: null, directionId: BJJ, groups: [] }),
        update: jest.fn().mockResolvedValue(row({ directionId: BJJ, direction: bjjRef })),
        delete: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      direction: { findFirst: jest.fn().mockResolvedValue({ id: BJJ }) },
    },
    rbac: rbac(false, [BJJ]),
    rt: { invalidate: jest.fn(), emitListDelta: jest.fn() },
  });

  it('creates in a managed direction; refuses another or club-wide', async () => {
    const d = deps();
    const handler = new CreateAnnouncementHandler(
      d.prisma as never,
      d.rbac as never,
      { notifyWorkspace: jest.fn() } as never,
      d.rt as never,
    );
    const f = (directionId?: string) =>
      new CreateAnnouncementFeature({ title: 'T', body: 'B', directionId }, 'w1', 'u1', 'coach', false);
    await handler.execute(f(BJJ));
    await expect(handler.execute(f(MMA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(handler.execute(f())).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.rbac.assertCanManageDirection).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(d.prisma.announcement.create).toHaveBeenCalledTimes(1);
  });

  it('update passes current + target and refuses a move to another direction', async () => {
    const d = deps();
    const handler = new UpdateAnnouncementHandler(
      d.prisma as never,
      d.rbac as never,
      { notifyWorkspace: jest.fn() } as never,
      d.rt as never,
    );
    await handler.execute(new UpdateAnnouncementFeature({ title: 'x' }, 'w1', 'a1', 'u1', 'coach', false));
    await expect(
      handler.execute(new UpdateAnnouncementFeature({ directionId: MMA }, 'w1', 'a1', 'u1', 'coach', false)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.rbac.assertCanManageDirection).toHaveBeenLastCalledWith(expect.anything(), BJJ, MMA);
    expect(d.prisma.announcement.update).toHaveBeenCalledTimes(1);
  });

  it('refuses deleting a club-wide announcement', async () => {
    const d = deps();
    d.prisma.announcement.findFirst.mockResolvedValue({
      id: 'a1',
      publishedAt: null,
      directionId: null,
      groups: [],
    });
    await expect(
      new DeleteAnnouncementHandler(d.prisma as never, d.rbac as never, d.rt as never).execute(
        new DeleteAnnouncementFeature('w1', 'a1', 'u1', 'coach', false),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.prisma.announcement.delete).not.toHaveBeenCalled();
  });

  it('list: scoped to managed directions; another direction yields nothing', async () => {
    const d = deps();
    const handler = new ListAnnouncementsHandler(d.prisma as never, d.rbac as never);
    await handler.execute(new ListAnnouncementsFeature({}, 'w1', 'u1', 'coach', false));
    expect(d.prisma.announcement.findMany.mock.calls[0][0].where).toEqual({
      workspaceId: 'w1',
      ...ownedByDirectionsWhere([BJJ]),
    });
    await handler.execute(new ListAnnouncementsFeature({ directionId: MMA }, 'w1', 'u1', 'coach', false));
    expect(d.prisma.announcement.findMany.mock.calls[1][0].where).toEqual({
      workspaceId: 'w1',
      ...ownedByDirectionsWhere([]),
    });
    await expect(
      new ListAnnouncementsHandler(d.prisma as never, rbac(false) as never).execute(
        new ListAnnouncementsFeature({}, 'w1', 'u1', 'coach', false),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('announcements addressed to groups', () => {
  const ADULTS = '33333333-3333-4333-8333-333333333333';
  const KIDS = '44444444-4444-4444-8444-444444444444';
  const MMA_GROUP = '55555555-5555-4555-8555-555555555555';
  const NO_DIRECTION = '66666666-6666-4666-8666-666666666666';
  const groupDirection: Record<string, string | null> = {
    [ADULTS]: BJJ,
    [KIDS]: BJJ,
    [MMA_GROUP]: MMA,
    [NO_DIRECTION]: null,
  };
  const adultsRow = {
    groupId: ADULTS,
    group: { id: ADULTS, name: 'Взрослые', directionId: BJJ, gym: { name: 'Центр' } },
  };
  const deps = (admin: boolean, managed: string[] = []) => ({
    prisma: {
      announcement: {
        create: jest.fn().mockResolvedValue(
          row({ publishedAt: new Date('2026-07-04Z'), groups: [adultsRow] }),
        ),
        findFirst: jest.fn().mockResolvedValue({
          id: 'a1',
          publishedAt: null,
          directionId: null,
          groups: [{ groupId: ADULTS, group: { directionId: BJJ } }],
        }),
        update: jest.fn().mockResolvedValue(row({ groups: [adultsRow] })),
        delete: jest.fn().mockResolvedValue({}),
      },
      direction: { findFirst: jest.fn().mockResolvedValue({ id: BJJ }) },
      // Only this club's groups come back; a foreign id is missing.
      group: {
        findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
          args.where.id.in
            .filter((id) => id in groupDirection)
            .map((id) => ({ directionId: groupDirection[id] })),
        ),
      },
    },
    rbac: rbac(admin, managed),
    rt: { invalidate: jest.fn(), emitListDelta: jest.fn() },
    notifyWorkspace: jest.fn(),
  });
  type Deps = ReturnType<typeof deps>;
  const create = (d: Deps, payload: Record<string, unknown>) =>
    new CreateAnnouncementHandler(
      d.prisma as never,
      d.rbac as never,
      { notifyWorkspace: d.notifyWorkspace } as never,
      d.rt as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B', ...payload } as never,
        'w1',
        'u1',
        'admin',
        false,
      ),
    );

  it('create: stores the groups, shows them with the hall, pushes only to them and refetches feeds', async () => {
    const d = deps(true);
    const out = await create(d, { publish: true, groupIds: [ADULTS, ADULTS] });
    const call = d.prisma.announcement.create.mock.calls[0][0];
    expect(call.data.directionId).toBeNull();
    expect(call.data.groups).toEqual({ create: [{ groupId: ADULTS }] });
    expect(d.prisma.group.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [ADULTS] },
      workspaceId: 'w1',
    });
    expect(out.groups).toEqual([
      { id: ADULTS, name: 'Взрослые', gymName: 'Центр', directionId: BJJ },
    ]);
    expect(out.direction).toBeNull();
    expect(d.notifyWorkspace.mock.calls[0][0].memberWhere).toEqual(
      announcementMemberWhere({
        audience: 'ALL',
        directionId: null,
        groups: [{ groupId: ADULTS }],
      }),
    );
    expect(d.rt.emitListDelta).not.toHaveBeenCalled();
    expect(d.rt.invalidate).toHaveBeenCalledWith('w1', ['announcements']);
  });

  it('create: refuses a direction and groups together, 404s a group of another club', async () => {
    const d = deps(true);
    await expect(
      create(d, { directionId: BJJ, groupIds: [ADULTS] }),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      create(d, { groupIds: ['77777777-7777-4777-8777-777777777777'] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(d.prisma.announcement.create).not.toHaveBeenCalled();
  });

  it('a direction manager addresses only groups of their directions', async () => {
    const d = deps(false, [BJJ]);
    await create(d, { groupIds: [ADULTS, KIDS] });
    expect(d.rbac.assertCanManageDirection).toHaveBeenLastCalledWith(
      expect.anything(),
      BJJ,
      BJJ,
    );
    await expect(
      create(d, { groupIds: [ADULTS, MMA_GROUP] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      create(d, { groupIds: [NO_DIRECTION] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.prisma.announcement.create).toHaveBeenCalledTimes(1);
  });

  it('a coach running no direction cannot address even their groups', async () => {
    const d = deps(false, []);
    await expect(create(d, { groupIds: [ADULTS] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('update: retargets direction → groups replacing the rows; a manager cannot move them to a foreign group', async () => {
    const d = deps(true);
    d.prisma.announcement.findFirst.mockResolvedValue({
      id: 'a1',
      publishedAt: null,
      directionId: BJJ,
      groups: [],
    });
    const update = (rb: unknown, payload: Record<string, unknown>) =>
      new UpdateAnnouncementHandler(
        d.prisma as never,
        rb as never,
        { notifyWorkspace: d.notifyWorkspace } as never,
        d.rt as never,
      ).execute(
        new UpdateAnnouncementFeature(payload as never, 'w1', 'a1', 'u1', 'coach', false),
      );
    await update(d.rbac, { directionId: null, groupIds: [ADULTS] });
    expect(d.prisma.announcement.update.mock.calls[0][0].data).toEqual({
      directionId: null,
      groups: { deleteMany: {}, create: [{ groupId: ADULTS }] },
    });
    const manager = rbac(false, [BJJ]);
    await expect(
      update(manager, { directionId: null, groupIds: [MMA_GROUP] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(manager.assertCanManageDirection).toHaveBeenLastCalledWith(
      expect.anything(),
      BJJ,
      MMA,
    );
    expect(d.prisma.announcement.update).toHaveBeenCalledTimes(1);
  });

  it('delete: the manager of the groups may; a target group deleted since leaves it to admins', async () => {
    const d = deps(false, [BJJ]);
    const del = () =>
      new DeleteAnnouncementHandler(d.prisma as never, d.rbac as never, d.rt as never).execute(
        new DeleteAnnouncementFeature('w1', 'a1', 'u1', 'coach', false),
      );
    await del();
    d.prisma.announcement.findFirst.mockResolvedValue({
      id: 'a1',
      publishedAt: null,
      directionId: null,
      groups: [{ groupId: null, group: null }],
    });
    await expect(del()).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.prisma.announcement.delete).toHaveBeenCalledTimes(1);
  });
});
