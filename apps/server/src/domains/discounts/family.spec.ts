import { loadFamilyEligibility, loadFamilyMemberIds } from './family'

type Link = { guardianId: string; dependentId: string; consentAt: Date | null }

// An in-memory guardianship table answering the two queries family.ts asks.
const db = (links: Link[], holders: string[] = []) => ({
    guardianship: {
        findMany: jest.fn(async ({ where }: { where: { OR: Array<Record<string, unknown>> } }) =>
            links.filter(
                (l) =>
                    l.consentAt !== null &&
                    where.OR.some((c) => {
                        const match = (field: 'guardianId' | 'dependentId') => {
                            const v = c[field] as string | { in: string[] } | undefined
                            if (v === undefined) return false
                            return typeof v === 'string' ? l[field] === v : v.in.includes(l[field])
                        }
                        return match('guardianId') || match('dependentId')
                    }),
            ),
        ),
    },
    subscription: {
        findFirst: jest.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
            where.userId.in.some((u) => holders.includes(u)) ? { id: 's1' } : null,
        ),
    },
})

const ok = new Date('2026-01-01')
const link = (guardianId: string, dependentId: string, consentAt: Date | null = ok): Link => ({
    guardianId,
    dependentId,
    consentAt,
})

describe('loadFamilyMemberIds', () => {
    it('two hops: parents, children, siblings via a shared parent, co-parents via a shared child', async () => {
        const links = [link('mom', 'kid1'), link('mom', 'kid2'), link('dad', 'kid1'), link('grandma', 'mom')]
        expect((await loadFamilyMemberIds(db(links) as never, 'kid2')).sort()).toEqual(['kid1', 'mom'])
        expect((await loadFamilyMemberIds(db(links) as never, 'dad')).sort()).toEqual(['kid1', 'mom'])
        expect((await loadFamilyMemberIds(db(links) as never, 'mom')).sort()).toEqual([
            'dad',
            'grandma',
            'kid1',
            'kid2',
        ])
    })

    it('ignores an unconfirmed link', async () => {
        const links = [link('mom', 'kid1'), link('mom', 'kid2', null)]
        expect(await loadFamilyMemberIds(db(links) as never, 'kid2')).toEqual([])
        expect(await loadFamilyMemberIds(db(links) as never, 'kid1')).toEqual(['mom'])
    })

    it('asks once when the buyer has no links', async () => {
        const d = db([])
        expect(await loadFamilyMemberIds(d as never, 'solo')).toEqual([])
        expect(d.guardianship.findMany).toHaveBeenCalledTimes(1)
    })
})

describe('loadFamilyEligibility', () => {
    const now = new Date('2027-03-01T10:00:00Z')

    it('qualifies when a relative holds a current abonement of this club (paid or not)', async () => {
        const d = db([link('mom', 'kid1'), link('mom', 'kid2')], ['kid1'])
        expect(await loadFamilyEligibility(d as never, { workspaceId: 'w1', userId: 'kid2', now })).toBe(true)
        const where = d.subscription.findFirst.mock.calls[0][0].where
        // The current-abonement rule: held by a membership, ACTIVE, not past
        // its end — no isPaid condition.
        expect(where).toMatchObject({
            workspaceId: 'w1',
            NOT: { workspaceMemberId: null },
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: now } }],
        })
        expect(where).not.toHaveProperty('isPaid')
    })

    it('does not qualify the first child, whose relative holds nothing', async () => {
        const d = db([link('mom', 'kid1'), link('mom', 'kid2')], ['kid1'])
        expect(await loadFamilyEligibility(d as never, { workspaceId: 'w1', userId: 'kid1', now })).toBe(false)
    })

    it('without relatives asks for no abonement', async () => {
        const d = db([])
        expect(await loadFamilyEligibility(d as never, { workspaceId: 'w1', userId: 'solo', now })).toBe(false)
        expect(d.subscription.findFirst).not.toHaveBeenCalled()
    })
})
