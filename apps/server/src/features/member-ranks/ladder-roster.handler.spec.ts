import { GetLadderRosterFeature } from './get-ladder-roster.feature';
import { GetLadderRosterHandler } from './get-ladder-roster.handler';
import { PromoteMembersFeature } from './promote-members.feature';
import { PromoteMembersHandler } from './promote-members.handler';

const OWNER = 'owner1';

const rbac = (admin = true) => ({
  resolveCoachScope: jest.fn().mockResolvedValue({
    scope: admin ? 'admin' : 'coach_own_only',
    workspaceOwnerId: OWNER,
  }),
  canWriteAllGroups: jest.fn().mockReturnValue(admin),
});

const user = (id: string, firstname: string | null, lastname: string | null) => ({
  id,
  firstname,
  lastname,
  email: `${id}@x.io`,
});

describe('getLadderRoster', () => {
  const feature = () =>
    new GetLadderRosterFeature('w1', 'l1', 'admin1', 'admin', false);

  const prismaFor = (over: Record<string, unknown> = {}) => ({
    rankLadder: { findFirst: jest.fn().mockResolvedValue({ id: 'l1' }) },
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue([
        { user: user('m2', 'Яна', 'Петрова') },
        { user: user('m1', 'Антон', 'Иванов') },
      ]),
    },
    user: { findUnique: jest.fn().mockResolvedValue(user(OWNER, 'Олег', 'Ким')) },
    rankPromotion: {
      findMany: jest.fn().mockResolvedValue([
        {
          userId: 'm2',
          levelId: 'lv2',
          stripes: 2,
          awardedAt: new Date('2026-09-01T00:00:00Z'),
          level: { name: 'Синий', color: '#1d4ed8' },
        },
      ]),
    },
    ...over,
  });

  it('refuses a caller without workspace-admin scope', async () => {
    const prisma = prismaFor();
    await expect(
      new GetLadderRosterHandler(prisma as never, rbac(false) as never).execute(
        feature(),
      ),
    ).rejects.toThrow('Нужны права администратора клуба');
    expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled();
  });

  it('404s a ladder from another club', async () => {
    const prisma = prismaFor({
      rankLadder: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      new GetLadderRosterHandler(prisma as never, rbac() as never).execute(
        feature(),
      ),
    ).rejects.toThrow('Лестница не найдена');
    expect(prisma.rankLadder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1', workspaceId: 'w1' } }),
    );
  });

  it('lists active members + the owner with their current level, owner first then by surname', async () => {
    const prisma = prismaFor();
    const out = await new GetLadderRosterHandler(
      prisma as never,
      rbac() as never,
    ).execute(feature());

    expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
      workspaceId: 'w1',
      status: 'ACTIVE',
      user: { deletedAt: null },
    });
    const promotionQuery = prisma.rankPromotion.findMany.mock.calls[0][0];
    expect(promotionQuery).toMatchObject({
      where: { workspaceId: 'w1', ladderId: 'l1' },
      distinct: ['userId'],
      orderBy: { awardedAt: 'desc' },
    });
    // Only today's roster — ex-members' history isn't loaded.
    expect([...promotionQuery.where.userId.in].sort()).toEqual(
      ['m1', 'm2', OWNER].sort(),
    );
    expect(out.data.map((e) => e.userId)).toEqual([OWNER, 'm1', 'm2']);
    expect(out.data[0]).toMatchObject({ isOwner: true, current: null });
    expect(out.data[2]).toEqual({
      userId: 'm2',
      firstname: 'Яна',
      lastname: 'Петрова',
      email: 'm2@x.io',
      isOwner: false,
      current: {
        levelId: 'lv2',
        levelName: 'Синий',
        color: '#1d4ed8',
        stripes: 2,
        awardedAt: '2026-09-01T00:00:00.000Z',
      },
    });
  });

  it('does not list the owner twice when they also have a member row', async () => {
    const prisma = prismaFor({
      workspaceMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ user: user(OWNER, 'Олег', 'Ким') }]),
      },
    });
    const out = await new GetLadderRosterHandler(
      prisma as never,
      rbac() as never,
    ).execute(feature());
    expect(out.data).toHaveLength(1);
    expect(out.data[0].isOwner).toBe(true);
  });
});

describe('promoteMembers', () => {
  const feature = (
    payload: Partial<{ userIds: string[]; stripes: number }> = {},
    invoker = 'admin1',
  ) =>
    new PromoteMembersFeature(
      { userIds: ['m1', 'm2'], levelId: 'lv1', stripes: 0, ...payload },
      'w1',
      'l1',
      invoker,
      'admin',
      false,
    );

  const setup = (opts: {
    admin?: boolean;
    activeIds?: string[];
    latest?: { userId: string; levelId: string; stripes: number }[];
  } = {}) => {
    const prisma = {
      workspaceMember: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            (opts.activeIds ?? ['m1', 'm2']).map((userId) => ({ userId })),
          ),
      },
      rankPromotion: {
        findMany: jest.fn().mockResolvedValue(opts.latest ?? []),
      },
    };
    const ranks = {
      promoteMany: jest
        .fn()
        .mockImplementation(async (p: { userIds: string[] }) =>
          p.userIds.map((userId) => ({
            id: `pr-${userId}`,
            userId,
            ladderId: 'l1',
            levelId: 'lv1',
            stripes: 0,
            level: { name: 'Белый' },
            ladder: { name: 'Взрослые' },
          })),
        ),
    };
    const notifications = { notifyUser: jest.fn() };
    const realtime = { invalidate: jest.fn() };
    const handler = new PromoteMembersHandler(
      prisma as never,
      rbac(opts.admin ?? true) as never,
      ranks as never,
      notifications as never,
      realtime as never,
    );
    return { prisma, ranks, notifications, realtime, handler };
  };

  it('refuses a caller without workspace-admin scope', async () => {
    const { handler, ranks } = setup({ admin: false });
    await expect(handler.execute(feature())).rejects.toThrow(
      'Нужны права администратора клуба',
    );
    expect(ranks.promoteMany).not.toHaveBeenCalled();
  });

  it('rejects the whole batch when any target is not an active member', async () => {
    const { handler, ranks } = setup({ activeIds: ['m1'] });
    await expect(handler.execute(feature())).rejects.toThrow(
      'Часть выбранных участников неактивна',
    );
    expect(ranks.promoteMany).not.toHaveBeenCalled();
  });

  it('promotes every target in one write, congratulates each, refreshes once', async () => {
    const { handler, ranks, notifications, realtime } = setup();
    const out = await handler.execute(feature({ stripes: 0 }));

    expect(ranks.promoteMany).toHaveBeenCalledTimes(1);
    expect(ranks.promoteMany).toHaveBeenCalledWith({
      workspaceId: 'w1',
      userIds: ['m1', 'm2'],
      ladderId: 'l1',
      levelId: 'lv1',
      stripes: 0,
      awardedById: 'admin1',
      note: undefined,
    });
    expect(notifications.notifyUser).toHaveBeenCalledTimes(2);
    expect(notifications.notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'm2',
        kind: 'rank.promoted',
        message: 'Поздравляем! Вам присвоен ранг: Белый — Взрослые',
        feature: 'ranks',
      }),
    );
    expect(realtime.invalidate).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ promoted: 2, unchanged: 0 });
  });

  it('lets a level/ladder not-found propagate without notifying or refreshing', async () => {
    const { handler, ranks, notifications, realtime } = setup();
    ranks.promoteMany.mockRejectedValueOnce(
      new Error('Ранг не найден в этой лестнице'),
    );
    await expect(handler.execute(feature())).rejects.toThrow(
      'Ранг не найден в этой лестнице',
    );
    expect(notifications.notifyUser).not.toHaveBeenCalled();
    expect(realtime.invalidate).not.toHaveBeenCalled();
  });

  it('keeps the batch when one congratulation fails after commit', async () => {
    const { handler, notifications, realtime } = setup();
    notifications.notifyUser.mockRejectedValueOnce(new Error('push down'));
    const out = await handler.execute(feature());
    expect(out).toEqual({ promoted: 2, unchanged: 0 });
    expect(notifications.notifyUser).toHaveBeenCalledTimes(2);
    expect(realtime.invalidate).toHaveBeenCalledTimes(1);
  });

  it('accepts the owner, who has no member row', async () => {
    const { handler, ranks } = setup({ activeIds: ['m1'] });
    const out = await handler.execute(feature({ userIds: ['m1', OWNER] }));
    expect(ranks.promoteMany.mock.calls[0][0].userIds).toEqual(['m1', OWNER]);
    expect(out.promoted).toBe(2);
  });

  it('skips members already at exactly this level + stripes', async () => {
    const { handler, ranks, notifications } = setup({
      latest: [{ userId: 'm1', levelId: 'lv1', stripes: 0 }],
    });
    const out = await handler.execute(feature({ stripes: 0 }));
    expect(ranks.promoteMany.mock.calls[0][0].userIds).toEqual(['m2']);
    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ promoted: 1, unchanged: 1 });
  });

  it('treats the same level with different stripes as a change', async () => {
    const { handler, ranks } = setup({
      latest: [
        { userId: 'm1', levelId: 'lv1', stripes: 1 },
        { userId: 'm2', levelId: 'lv1', stripes: 2 },
      ],
    });
    const out = await handler.execute(feature({ stripes: 2 }));
    expect(ranks.promoteMany.mock.calls[0][0].userIds).toEqual(['m1']);
    expect(out).toEqual({ promoted: 1, unchanged: 1 });
  });

  it('writes nothing and sends no refresh when everyone is already there', async () => {
    const { handler, ranks, realtime } = setup({
      latest: [
        { userId: 'm1', levelId: 'lv1', stripes: 0 },
        { userId: 'm2', levelId: 'lv1', stripes: 0 },
      ],
    });
    const out = await handler.execute(feature());
    expect(ranks.promoteMany).not.toHaveBeenCalled();
    expect(realtime.invalidate).not.toHaveBeenCalled();
    expect(out).toEqual({ promoted: 0, unchanged: 2 });
  });

  it('does not congratulate an admin who ranks themselves', async () => {
    const { handler, notifications } = setup({ activeIds: ['m1', 'admin1'] });
    await handler.execute(feature({ userIds: ['m1', 'admin1'] }, 'admin1'));
    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
    expect(notifications.notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'm1' }),
    );
  });

  it('dedupes repeated ids before checking eligibility', async () => {
    const { handler, ranks } = setup({ activeIds: ['m1'] });
    const out = await handler.execute(feature({ userIds: ['m1', 'm1'] }));
    expect(ranks.promoteMany.mock.calls[0][0].userIds).toEqual(['m1']);
    expect(out.promoted).toBe(1);
  });
});
