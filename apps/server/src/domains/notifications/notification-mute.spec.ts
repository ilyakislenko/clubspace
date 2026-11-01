import { filterMuted, isMutedFor, isMuteExempt } from './notification-mute'

describe('isMuteExempt', () => {
    it.each([
        'subscription.payment_due',
        'access.expiring',
        'classes.low',
        'freeze.approved',
        'personal.confirmed',
        'member.approved',
        'member.invitation',
        'dropin.cancelled',
        'exception.notify',
        'grading.moved',
        'substitution.members',
        'substitution.requested',
    ])('keeps %s', (kind) => {
        expect(isMuteExempt(kind)).toBe(true)
    })

    it.each([
        'announcement.published',
        'video.published',
        'session.reminder',
        'event.reminder',
        'member.inactive',
        'achievement.unlocked',
        'constructor',
    ])('mutes %s', (kind) => {
        expect(isMuteExempt(kind)).toBe(false)
    })
})

describe('isMutedFor', () => {
    const prisma = (row: unknown) => ({
        workspaceMember: { findUnique: jest.fn().mockResolvedValue(row) },
    })

    it('is false without a club, without a reading', async () => {
        const p = prisma({ notificationsMuted: true })
        await expect(
            isMutedFor(p as never, { userId: 'u', kind: 'video.published' }),
        ).resolves.toBe(false)
        expect(p.workspaceMember.findUnique).not.toHaveBeenCalled()
    })

    it('follows the member row for a non-exempt kind', async () => {
        await expect(
            isMutedFor(prisma({ notificationsMuted: true }) as never, {
                userId: 'u',
                workspaceId: 'w',
                kind: 'video.published',
            }),
        ).resolves.toBe(true)
        await expect(
            isMutedFor(prisma(null) as never, {
                userId: 'u',
                workspaceId: 'w',
                kind: 'video.published',
            }),
        ).resolves.toBe(false)
    })
})

describe('filterMuted', () => {
    const row = (userId: string, kind: string, workspaceId?: string) => ({
        userId,
        metadata: { kind, ...(workspaceId ? { workspaceId } : {}) },
    })

    it('drops only muted (user, club) pairs for non-exempt kinds in one query', async () => {
        const findMany = jest
            .fn()
            .mockResolvedValue([{ userId: 'a', workspaceId: 'w1' }])
        const rows = [
            row('a', 'session.reminder', 'w1'),
            row('a', 'session.reminder', 'w2'),
            row('b', 'session.reminder', 'w1'),
            row('a', 'access.expiring', 'w1'),
            row('a', 'video.ready'),
        ]
        const kept = await filterMuted(
            { workspaceMember: { findMany } } as never,
            rows,
        )
        expect(kept).toEqual([rows[1], rows[2], rows[3], rows[4]])
        expect(findMany).toHaveBeenCalledTimes(1)
        expect(findMany.mock.calls[0][0].where).toEqual({
            notificationsMuted: true,
            userId: { in: ['a', 'b'] },
            workspaceId: { in: ['w1', 'w2'] },
        })
    })

    it('skips the query when nothing could be muted', async () => {
        const findMany = jest.fn()
        const rows = [row('a', 'access.expiring', 'w1')]
        await expect(
            filterMuted({ workspaceMember: { findMany } } as never, rows),
        ).resolves.toBe(rows)
        expect(findMany).not.toHaveBeenCalled()
    })

    it('returns every row when nobody muted', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        const rows = [row('a', 'session.reminder', 'w1')]
        await expect(
            filterMuted({ workspaceMember: { findMany } } as never, rows),
        ).resolves.toBe(rows)
    })
})
