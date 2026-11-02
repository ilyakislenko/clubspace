import { DEMO_CLUBS } from './demo-clubs'
import { deleteDemoOnlyUsers, wipeDemoWorkspace } from './demo-club.wipe'

const MODELS = [
    'attendanceRecord',
    'subscriptionFreezeRequest',
    'subscriptionFreeze',
    'payment',
    'subscription',
    'rankGradingCandidate',
    'rankPromotion',
    'videoFavorite',
    'videoTag',
    'trainingJournalEntry',
    'auditEvent',
    'consentRecord',
    'guardianship',
]

const buildTx = () => {
    const order: string[] = []
    const tx: Record<string, Record<string, jest.Mock>> = {}
    for (const m of MODELS) {
        tx[m] = {
            deleteMany: jest.fn().mockImplementation(async () => {
                order.push(m)
                return { count: 0 }
            }),
        }
    }
    tx.workspace = {
        delete: jest.fn().mockImplementation(async () => order.push('workspace')),
        findMany: jest.fn().mockResolvedValue([{ ownerId: 'u-owner' }]),
    }
    tx.user = {
        findMany: jest
            .fn()
            .mockResolvedValueOnce([{ id: 'u-1' }, { id: 'u-owner' }])
            .mockResolvedValueOnce([{ id: 'acc-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    }
    return { tx, order }
}

describe('wipeDemoWorkspace', () => {
    it('clears what the club cascade cannot reach, then the club, all scoped to it', async () => {
        const { tx, order } = buildTx()
        await wipeDemoWorkspace(tx as never, 'w-demo')
        expect(order[order.length - 1]).toBe('workspace')
        expect(order.indexOf('subscription')).toBeLessThan(order.indexOf('workspace'))
        expect(order.indexOf('rankPromotion')).toBeLessThan(order.indexOf('workspace'))
        expect(tx.workspace.delete).toHaveBeenCalledWith({ where: { id: 'w-demo' } })
        for (const m of MODELS.filter((x) => !['videoTag', 'consentRecord', 'guardianship'].includes(x))) {
            expect(tx[m].deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'w-demo' } })
        }
        expect(tx.videoTag.deleteMany).toHaveBeenCalledWith({ where: { video: { workspaceId: 'w-demo' } } })
    })
})

describe('deleteDemoOnlyUsers', () => {
    it('deletes generated people with no club left, never an owner or a fixed account', async () => {
        const { tx } = buildTx()
        await expect(deleteDemoOnlyUsers(tx as never, DEMO_CLUBS.academy)).resolves.toBe(1)
        const where = tx.user.findMany.mock.calls[0][0].where
        expect(where.isDemo).toBe(true)
        expect(where.workspaceMemberships).toEqual({ none: {} })
        // Fixed accounts of every demo club are kept.
        expect(where.OR[1].email.notIn).toEqual(expect.arrayContaining(['owner@academy.demo', 'owner@ritm.demo']))
        expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['u-1'] } } })
        // The kept accounts get their consent evidence and family links rebuilt.
        expect(tx.consentRecord.deleteMany).toHaveBeenCalledWith({ where: { userId: { in: ['acc-1'] } } })
        expect(tx.guardianship.deleteMany).toHaveBeenCalledWith({ where: { guardianId: { in: ['acc-1'] } } })
    })

    it('never reaches into the other demo club: its leavers and parents stay', async () => {
        const { tx } = buildTx()
        await deleteDemoOnlyUsers(tx as never, DEMO_CLUBS.ritm)
        const where = tx.user.findMany.mock.calls[0][0].where
        expect(where.subscriptions).toEqual({ none: {} })
        expect(where.attendanceRecords).toEqual({ none: {} })
        expect(where.guardianOf).toEqual({ none: { dependent: { workspaceMemberships: { some: {} } } } })
        // Only the studio's own fixed accounts get their links rebuilt.
        const accounts = tx.user.findMany.mock.calls[1][0].where.email.in
        expect(accounts).toEqual(['owner@ritm.demo', 'pedagog@ritm.demo', 'student@ritm.demo', 'parent@ritm.demo'])
    })
})
