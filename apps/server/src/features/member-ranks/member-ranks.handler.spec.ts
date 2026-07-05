import { GetMemberRanksFeature } from './get-member-ranks.feature'
import { GetMemberRanksHandler } from './get-member-ranks.handler'
import { PromoteMemberFeature } from './promote-member.feature'
import { PromoteMemberHandler } from './promote-member.handler'

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

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
})

describe('promoteMember', () => {
    const feature = () =>
        new PromoteMemberFeature(
            { ladderId: 'l1', levelId: 'lv2', stripes: 1 },
            'w1',
            'm1',
            'coach1',
            'admin',
            false,
        )

    it('promotes an active member and returns the serialized promotion', async () => {
        const prisma = {
            workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'o' }) },
            workspaceMember: { findFirst: jest.fn().mockResolvedValue({ id: 'wm1' }) },
        }
        const ranks = { promote: jest.fn().mockResolvedValue(promotionRow()) }
        const out = await new PromoteMemberHandler(
            prisma as never,
            rbac() as never,
            ranks as never,
            { notifyUser: jest.fn() } as never,
        ).execute(feature())
        expect(ranks.promote).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'w1',
                userId: 'm1',
                ladderId: 'l1',
                levelId: 'lv2',
                awardedById: 'coach1',
            }),
        )
        expect(out).toMatchObject({ levelName: 'Blue', ladderName: 'Adults', stripes: 1 })
    })

    it('allows promoting the owner (no member row)', async () => {
        const prisma = {
            workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'm1' }) },
            workspaceMember: { findFirst: jest.fn() },
        }
        const ranks = { promote: jest.fn().mockResolvedValue(promotionRow()) }
        await new PromoteMemberHandler(
            prisma as never,
            rbac() as never,
            ranks as never,
            { notifyUser: jest.fn() } as never,
        ).execute(feature())
        expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled()
        expect(ranks.promote).toHaveBeenCalled()
    })

    it('rejects a non-member target', async () => {
        const prisma = {
            workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'o' }) },
            workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
        }
        const ranks = { promote: jest.fn() }
        await expect(
            new PromoteMemberHandler(
                prisma as never,
                rbac() as never,
                ranks as never,
                { notifyUser: jest.fn() } as never,
            ).execute(feature()),
        ).rejects.toThrow(/active member/i)
        expect(ranks.promote).not.toHaveBeenCalled()
    })

    it('forbids a non-admin', async () => {
        const ranks = { promote: jest.fn() }
        await expect(
            new PromoteMemberHandler(
                {} as never,
                rbac(false) as never,
                ranks as never,
                { notifyUser: jest.fn() } as never,
            ).execute(feature()),
        ).rejects.toThrow(/admin/i)
    })
})

describe('getMemberRanks', () => {
    it('returns the latest promotion per ladder as current', async () => {
        const prisma = {
            rankPromotion: {
                findMany: jest.fn().mockResolvedValue([
                    promotionRow({ id: 'p3', ladderId: 'l1', level: { name: 'Blue', color: null }, awardedAt: new Date('2026-07-03Z') }),
                    promotionRow({ id: 'p2', ladderId: 'l2', level: { name: 'Kids-Yellow', color: null }, ladder: { name: 'Kids' }, awardedAt: new Date('2026-06-01Z') }),
                    promotionRow({ id: 'p1', ladderId: 'l1', level: { name: 'White', color: null }, awardedAt: new Date('2026-01-01Z') }),
                ]),
            },
        }
        const out = await new GetMemberRanksHandler(
            prisma as never,
            rbac() as never,
        ).execute(new GetMemberRanksFeature('w1', 'm1', 'u1', 'admin', false))
        expect(out.history).toHaveLength(3)
        expect(out.current.map((c) => c.id)).toEqual(['p3', 'p2']) // one per ladder, latest
    })
})
