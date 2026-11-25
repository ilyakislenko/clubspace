import { filterRoutedRows } from './recipient-gates'

type Row = Parameters<typeof filterRoutedRows>[1][number]

// A guardian copy as routeToGuardians writes it.
const routed = (guardianId: string, kind: string, over: Partial<Row> = {}): Row => ({
    userId: guardianId,
    metadata: { kind, workspaceId: 'w1', dependentId: 'kid' },
    ...over,
})

const makePrisma = (o: {
    prefs?: Array<Record<string, unknown> & { userId: string }>
    muted?: Array<{ userId: string; workspaceId: string }>
} = {}) => ({
    notificationPreferences: { findMany: jest.fn().mockResolvedValue(o.prefs ?? []) },
    workspaceMember: { findMany: jest.fn().mockResolvedValue(o.muted ?? []) },
})

describe('filterRoutedRows', () => {
    it('drops the copy of a guardian who opted out of the category; a second guardian keeps theirs', async () => {
        const prisma = makePrisma({ prefs: [{ userId: 'mom', announcementsEnabled: false }] })
        const rows = [
            routed('mom', 'announcement.published', { category: 'announcementsEnabled' }),
            routed('dad', 'announcement.published', { category: 'announcementsEnabled' }),
        ]
        expect((await filterRoutedRows(prisma as never, rows)).map((r) => r.userId)).toEqual(['dad'])
        expect(prisma.notificationPreferences.findMany).toHaveBeenCalledWith({
            where: { userId: { in: ['mom', 'dad'] } },
        })
    })

    it('a prefs row with the category on (or none at all) keeps the copy', async () => {
        const prisma = makePrisma({ prefs: [{ userId: 'mom', announcementsEnabled: true, newVideosEnabled: false }] })
        const rows = [
            routed('mom', 'announcement.published', { category: 'announcementsEnabled' }),
            routed('dad', 'announcement.published', { category: 'announcementsEnabled' }),
        ]
        expect(await filterRoutedRows(prisma as never, rows)).toEqual(rows)
    })

    it('drops a non-exempt kind for a guardian who muted the club, keeps payment.succeeded', async () => {
        const prisma = makePrisma({ muted: [{ userId: 'mom', workspaceId: 'w1' }] })
        const rows = [
            routed('mom', 'announcement.published'),
            routed('mom', 'payment.succeeded'),
            routed('dad', 'announcement.published'),
        ]
        const kept = await filterRoutedRows(prisma as never, rows)
        expect(kept.map((r) => `${r.userId}:${r.metadata.kind}`)).toEqual([
            'mom:payment.succeeded',
            'dad:announcement.published',
        ])
        expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
            where: {
                userId: { in: ['mom', 'dad'] },
                workspaceId: { in: ['w1'] },
                status: 'ACTIVE',
                notificationsMuted: true,
            },
            select: { userId: true, workspaceId: true },
        })
    })

    it('a mute of another club does not count', async () => {
        const prisma = makePrisma({ muted: [{ userId: 'mom', workspaceId: 'w2' }] })
        const rows = [routed('mom', 'announcement.published')]
        expect(await filterRoutedRows(prisma as never, rows)).toEqual(rows)
    })

    it('without a category on the row only the mute is checked', async () => {
        const prisma = makePrisma({ prefs: [{ userId: 'mom', announcementsEnabled: false }] })
        const rows = [routed('mom', 'classes.cancelled')]
        expect(await filterRoutedRows(prisma as never, rows)).toEqual(rows)
        expect(prisma.notificationPreferences.findMany).not.toHaveBeenCalled()
        // An exempt kind: nothing to look up at all.
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('leaves direct rows untouched and asks nothing when no row is routed', async () => {
        const prisma = makePrisma({
            prefs: [{ userId: 'adult', announcementsEnabled: false }],
            muted: [{ userId: 'adult', workspaceId: 'w1' }],
        })
        const rows: Row[] = [
            { userId: 'adult', category: 'announcementsEnabled', metadata: { kind: 'announcement.published', workspaceId: 'w1' } },
        ]
        expect(await filterRoutedRows(prisma as never, rows)).toEqual(rows)
        expect(prisma.notificationPreferences.findMany).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('in a mixed batch only the guardian copies are gated', async () => {
        const prisma = makePrisma({ prefs: [{ userId: 'mom', newVideosEnabled: false }] })
        const direct: Row = {
            userId: 'mom',
            category: 'newVideosEnabled',
            metadata: { kind: 'video.published', workspaceId: 'w1' },
        }
        const rows = [direct, routed('mom', 'video.published', { category: 'newVideosEnabled' })]
        expect(await filterRoutedRows(prisma as never, rows)).toEqual([direct])
    })

    it('a row without a club is never muted', async () => {
        const prisma = makePrisma({ muted: [{ userId: 'mom', workspaceId: 'w1' }] })
        const rows: Row[] = [{ userId: 'mom', metadata: { kind: 'announcement.published', dependentId: 'kid' } }]
        expect(await filterRoutedRows(prisma as never, rows)).toEqual(rows)
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })
})
