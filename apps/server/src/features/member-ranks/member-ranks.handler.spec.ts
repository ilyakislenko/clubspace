import { ForbiddenError } from '../../shared/errors/shared.errors';
import { GetMemberRanksFeature } from './get-member-ranks.feature';
import { GetMemberRanksHandler } from './get-member-ranks.handler';
import { PromoteMemberFeature } from './promote-member.feature';
import { PromoteMemberHandler } from './promote-member.handler';

const forbidden = () =>
  new ForbiddenError({ message: 'Нужны права администратора клуба' });

const rbac = (admin = true) => ({
  resolveCoachScope: jest
    .fn()
    .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
  canWriteAllGroups: jest.fn().mockReturnValue(admin),
  assertCanManageDirection: admin
    ? jest.fn().mockResolvedValue(undefined)
    : jest.fn().mockRejectedValue(forbidden()),
  assertManagesDirections: admin
    ? jest.fn().mockResolvedValue(null)
    : jest.fn().mockRejectedValue(forbidden()),
});

// A coach who runs the BJJ direction.
const manager = () => ({
  resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'coach_own_only' }),
  canWriteAllGroups: jest.fn().mockReturnValue(false),
  assertCanManageDirection: jest.fn().mockResolvedValue(undefined),
  assertManagesDirections: jest.fn().mockResolvedValue(['dir-bjj']),
});

const ladderLookup = (directionId: string | null = null) => ({
  findFirst: jest.fn().mockResolvedValue({ directionId }),
});

const promotionRow = (over: Record<string, unknown> = {}) => ({
  id: 'pr1',
  ladderId: 'l1',
  ladder: { name: 'Adults' },
  levelId: 'lv2',
  level: { name: 'Blue', color: '#2b6cb0' },
  stripes: 1,
  note: null,
  awardedAt: new Date('2026-07-04T00:00:00Z'),
  ...over,
});

describe('promoteMember', () => {
  const feature = () =>
    new PromoteMemberFeature(
      { ladderId: 'l1', levelId: 'lv2', stripes: 1 },
      'w1',
      'm1',
      'coach1',
      'admin',
      false,
    );

  it('promotes an active member and returns the serialized promotion', async () => {
    const prisma = {
      rankLadder: ladderLookup(),
      workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'o' }) },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'wm1' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          firstname: 'Иван',
          lastname: 'Петров',
          status: 'ACTIVE',
        }),
      },
    };
    const ranks = { promote: jest.fn().mockResolvedValue(promotionRow()) };
    const out = await new PromoteMemberHandler(
      prisma as never,
      rbac() as never,
      ranks as never,
      { notifyUser: jest.fn() } as never,
      { invalidate: jest.fn() } as never,
    ).execute(feature());
    expect(ranks.promote).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        userId: 'm1',
        ladderId: 'l1',
        levelId: 'lv2',
        awardedById: 'coach1',
      }),
    );
    expect(out).toMatchObject({
      levelName: 'Blue',
      ladderName: 'Adults',
      stripes: 1,
      awardedByName: 'Иван Петров',
    });
  });

  it('allows promoting the owner (no member row)', async () => {
    const prisma = {
      rankLadder: ladderLookup(),
      workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'm1' }) },
      workspaceMember: { findFirst: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const ranks = { promote: jest.fn().mockResolvedValue(promotionRow()) };
    await new PromoteMemberHandler(
      prisma as never,
      rbac() as never,
      ranks as never,
      { notifyUser: jest.fn() } as never,
      { invalidate: jest.fn() } as never,
    ).execute(feature());
    expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
    expect(ranks.promote).toHaveBeenCalled();
  });

  it('rejects a non-member target', async () => {
    const prisma = {
      rankLadder: ladderLookup(),
      workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'o' }) },
      workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const ranks = { promote: jest.fn() };
    await expect(
      new PromoteMemberHandler(
        prisma as never,
        rbac() as never,
        ranks as never,
        { notifyUser: jest.fn() } as never,
        { invalidate: jest.fn() } as never,
      ).execute(feature()),
    ).rejects.toThrow(/Участник неактивен/i);
    expect(ranks.promote).not.toHaveBeenCalled();
  });

  it('forbids a coach outside the ladder direction', async () => {
    const ranks = { promote: jest.fn() };
    const prisma = { rankLadder: ladderLookup('dir-mma') };
    const r = rbac(false);
    await expect(
      new PromoteMemberHandler(
        prisma as never,
        r as never,
        ranks as never,
        { notifyUser: jest.fn() } as never,
        { invalidate: jest.fn() } as never,
      ).execute(feature()),
    ).rejects.toThrow(/администратор/i);
    expect(r.assertCanManageDirection).toHaveBeenCalledWith(
      expect.anything(),
      'dir-mma',
    );
    expect(ranks.promote).not.toHaveBeenCalled();
  });

  it('lets the manager of the ladder direction promote', async () => {
    const prisma = {
      rankLadder: ladderLookup('dir-bjj'),
      workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'o' }) },
      workspaceMember: { findFirst: jest.fn().mockResolvedValue({ id: 'wm1' }) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const ranks = { promote: jest.fn().mockResolvedValue(promotionRow()) };
    const r = manager();
    await new PromoteMemberHandler(
      prisma as never,
      r as never,
      ranks as never,
      { notifyUser: jest.fn() } as never,
      { invalidate: jest.fn() } as never,
    ).execute(feature());
    expect(prisma.rankLadder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1', workspaceId: 'w1' } }),
    );
    expect(r.assertCanManageDirection).toHaveBeenCalledWith(
      expect.anything(),
      'dir-bjj',
    );
    expect(ranks.promote).toHaveBeenCalled();
  });
});

describe('getMemberRanks', () => {
  it('returns the latest promotion per ladder as current', async () => {
    const prisma = {
      rankPromotion: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            promotionRow({
              id: 'p3',
              ladderId: 'l1',
              level: { name: 'Blue', color: null },
              awardedAt: new Date('2026-07-03Z'),
            }),
            promotionRow({
              id: 'p2',
              ladderId: 'l2',
              level: { name: 'Kids-Yellow', color: null },
              ladder: { name: 'Kids' },
              awardedAt: new Date('2026-06-01Z'),
            }),
            promotionRow({
              id: 'p1',
              ladderId: 'l1',
              level: { name: 'White', color: null },
              awardedAt: new Date('2026-01-01Z'),
            }),
          ]),
      },
    };
    const out = await new GetMemberRanksHandler(
      prisma as never,
      rbac() as never,
    ).execute(new GetMemberRanksFeature('w1', 'm1', 'u1', 'admin', false));
    expect(out.history).toHaveLength(3);
    expect(out.current.map((c) => c.id)).toEqual(['p3', 'p2']); // one per ladder, latest
  });

  it('shows a manager only their directions ranks of the member', async () => {
    const prisma = { rankPromotion: { findMany: jest.fn().mockResolvedValue([]) } };
    await new GetMemberRanksHandler(prisma as never, manager() as never).execute(
      new GetMemberRanksFeature('w1', 'm1', 'u1', 'coach', false),
    );
    expect(prisma.rankPromotion.findMany.mock.calls[0][0].where).toEqual({
      workspaceId: 'w1',
      userId: 'm1',
      ladder: { directionId: { in: ['dir-bjj'] } },
    });
  });

  it('refuses a coach who manages no direction', async () => {
    const prisma = { rankPromotion: { findMany: jest.fn() } };
    await expect(
      new GetMemberRanksHandler(prisma as never, rbac(false) as never).execute(
        new GetMemberRanksFeature('w1', 'm1', 'u1', 'coach', false),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.rankPromotion.findMany).not.toHaveBeenCalled();
  });
});
