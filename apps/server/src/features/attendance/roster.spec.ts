import { buildRoster } from './roster'

const makePrisma = () => ({
    attendanceRecord: { findMany: jest.fn() },
    groupMember: { findMany: jest.fn() },
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn() },
    subscriptionFreeze: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
    },
})

describe('buildRoster — group session', () => {
    it('pre-populates group members with present flags and adds guests', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([
            { userId: 'm1', isGuest: false },
            { userId: 'g9', isGuest: true },
        ])
        p.groupMember.findMany.mockResolvedValue([
            { userId: 'm1', user: { firstname: 'Ann', lastname: null, email: 'a@x' } },
            { userId: 'm2', user: { firstname: null, lastname: null, email: 'm2@x' } },
        ])
        p.user.findMany.mockResolvedValue([
            { id: 'g9', firstname: 'Guest', lastname: null, email: 'g@x' },
        ])
        const out = await buildRoster(p as any, {
            id: 'sess1',
            workspaceId: 'w1',
            startAt: new Date('2026-10-24T16:00:00Z'),
            checkInCode: null,
            groupId: 'grp',
            slotId: 's1',
            occurrenceKey: 'slot:s1:2026-10-24',
            workspaceEventId: null,
        })
        expect(out.kind).toBe('scheduled')
        expect(out.roster).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ userId: 'm1', present: true, isGuest: false, displayName: 'Ann' }),
                expect.objectContaining({ userId: 'm2', present: false, isGuest: false, displayName: 'm2@x' }),
                expect.objectContaining({ userId: 'g9', present: true, isGuest: true, displayName: 'Guest' }),
            ]),
        )
        expect(out.expected).toEqual([])
    })

    it('returns booked guests as expected, flagged present once marked', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([
            { userId: 'b2', isGuest: true },
        ])
        p.groupMember.findMany.mockResolvedValue([])
        p.user.findMany.mockResolvedValue([
            { id: 'b2', firstname: 'Bob', lastname: null, email: 'b@x' },
        ])
        p.dropInBooking.findMany.mockResolvedValue([
            { userId: 'b1', user: { firstname: 'Ann', lastname: null, email: 'a@x' } },
            { userId: 'b2', user: { firstname: 'Bob', lastname: null, email: 'b@x' } },
        ])
        const out = await buildRoster(p as any, {
            id: 'sess1',
            workspaceId: 'w1',
            startAt: new Date('2026-10-24T16:00:00Z'),
            checkInCode: null,
            groupId: 'grp',
            slotId: 's1',
            occurrenceKey: 'slot:s1:2026-10-24',
            workspaceEventId: null,
        })
        expect(out.expected).toEqual([
            { userId: 'b1', displayName: 'Ann', present: false, source: 'booking' },
            { userId: 'b2', displayName: 'Bob', present: true, source: 'booking' },
        ])
    })
})

describe('buildRoster — event session', () => {
    it('returns marked attendees only with isGuest null', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([{ userId: 'a1', isGuest: null }])
        p.user.findMany.mockResolvedValue([
            { id: 'a1', firstname: 'Ivan', lastname: 'P', email: 'i@x' },
        ])
        const out = await buildRoster(p as any, {
            id: 'sess2',
            workspaceId: 'w1',
            startAt: new Date('2026-10-24T16:00:00Z'),
            checkInCode: null,
            groupId: null,
            slotId: null,
            occurrenceKey: 'event:e1',
            workspaceEventId: 'e1',
        })
        expect(out.kind).toBe('event')
        expect(p.groupMember.findMany).not.toHaveBeenCalled()
        expect(out.roster).toEqual([
            {
                userId: 'a1',
                displayName: 'Ivan P',
                present: true,
                isGuest: null,
                frozenUntil: null,
            },
        ])
    })
})

describe('buildRoster — frozen abonement badge', () => {
    const session = {
        id: 'sess1',
        workspaceId: 'w1',
        groupId: 'grp',
        slotId: 's1',
        occurrenceKey: 'slot:s1:2026-10-25',
        workspaceEventId: null,
        checkInCode: null,
        // 02:00 Moscow on the 25th: the club day is the 25th, not the UTC 24th.
        startAt: new Date('2026-10-24T23:00:00Z'),
    }

    it('fills frozenUntil from the freeze covering the session day', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([
            { userId: 'm1', user: { firstname: 'Ann', lastname: null, email: 'a@x' } },
            { userId: 'm2', user: { firstname: 'Bob', lastname: null, email: 'b@x' } },
        ])
        p.subscriptionFreeze.findMany.mockResolvedValue([
            { userId: 'm1', untilDate: new Date('2026-10-30T00:00:00Z') },
        ])
        const out = await buildRoster(p as any, session)
        expect(p.workspace.findUnique).toHaveBeenCalledWith({
            where: { id: 'w1' },
            select: { timezone: true },
        })
        expect(p.subscriptionFreeze.findMany).toHaveBeenCalledWith({
            where: {
                workspaceId: 'w1',
                userId: { in: ['m1', 'm2'] },
                fromDate: { lte: new Date('2026-10-25T00:00:00Z') },
                untilDate: { gte: new Date('2026-10-25T00:00:00Z') },
                subscription: { status: 'ACTIVE' },
            },
            select: { userId: true, untilDate: true },
        })
        expect(out.roster.find((r) => r.userId === 'm1')?.frozenUntil).toBe('2026-10-30')
        expect(out.roster.find((r) => r.userId === 'm2')?.frozenUntil).toBeNull()
    })

    it('uses the workspace timezone even if the session carries another one', async () => {
        const p = makePrisma()
        p.workspace.findUnique.mockResolvedValue({ timezone: 'America/New_York' })
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([
            { userId: 'm1', user: { firstname: 'Ann', lastname: null, email: 'a@x' } },
        ])
        await buildRoster(p as any, { ...session, timezone: 'Europe/Moscow' } as any)
        // 23:00Z on the 24th is the 25th in Moscow but still the 24th (19:00)
        // in the club's New York calendar.
        expect(
            p.subscriptionFreeze.findMany.mock.calls[0][0].where.fromDate,
        ).toEqual({ lte: new Date('2026-10-24T00:00:00Z') })
    })

    it('skips the freeze lookup for an empty roster', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([])
        await buildRoster(p as any, session)
        expect(p.subscriptionFreeze.findMany).not.toHaveBeenCalled()
    })
})
