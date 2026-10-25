import { buildRoster } from './roster'

const ALL = { userId: 'coach1', seesAllGroups: true }

const makePrisma = () => ({
    attendanceRecord: { findMany: jest.fn() },
    groupMember: { findMany: jest.fn() },
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn() },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    subscription: { findMany: jest.fn().mockResolvedValue([]) },
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
            isPersonal: false,
        }, ALL)
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
            { userId: 'b1', user: { firstname: 'Ann', lastname: null, email: 'a@x', workspaceMemberships: [] } },
            { userId: 'b2', user: { firstname: 'Bob', lastname: null, email: 'b@x', workspaceMemberships: [] } },
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
            isPersonal: false,
        }, ALL)
        expect(out.expected).toEqual([
            { userId: 'b1', displayName: 'Ann', present: false, source: 'booking', frozenUntil: null, classesLeft: null },
            { userId: 'b2', displayName: 'Bob', present: true, source: 'booking', frozenUntil: null, classesLeft: null },
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
            isPersonal: false,
        }, ALL)
        expect(out.kind).toBe('event')
        expect(p.groupMember.findMany).not.toHaveBeenCalled()
        expect(out.roster).toEqual([
            {
                userId: 'a1',
                displayName: 'Ivan P',
                present: true,
                isGuest: null,
                frozenUntil: null,
                awaitingPayment: null,
                canViewSubscription: false,
            },
        ])
    })
})

describe('buildRoster — personal session', () => {
    it('reports kind personal and the one member as expected', async () => {
        const p = makePrisma() as any
        p.personalTrainingRequest = {
            findUnique: jest.fn().mockResolvedValue({
                memberId: 'm1',
                member: { firstname: 'Ann', lastname: null, email: 'a@x' },
            }),
        }
        p.attendanceRecord.findMany.mockResolvedValue([])
        const out = await buildRoster(p, {
            id: 'sess3',
            workspaceId: 'w1',
            startAt: new Date('2026-10-24T16:00:00Z'),
            checkInCode: null,
            groupId: null,
            slotId: null,
            occurrenceKey: 'personal:r1',
            workspaceEventId: null,
            isPersonal: true,
        }, ALL)
        expect(out.kind).toBe('personal')
        expect(out.checkInCode).toBeNull()
        expect(out.roster).toEqual([])
        expect(out.expected).toEqual([
            expect.objectContaining({
                userId: 'm1',
                displayName: 'Ann',
                present: false,
                source: 'personal',
            }),
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
        isPersonal: false,
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
        const out = await buildRoster(p as any, session, ALL)
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
        await buildRoster(p as any, { ...session, timezone: 'Europe/Moscow' } as any, ALL)
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
        await buildRoster(p as any, session, ALL)
        expect(p.subscriptionFreeze.findMany).not.toHaveBeenCalled()
    })

    it('badges a booked guest whose abonement is frozen on the class day', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([])
        p.dropInBooking.findMany.mockResolvedValue([
            { userId: 'b1', user: { firstname: 'Ann', lastname: null, email: 'a@x', workspaceMemberships: [] } },
            { userId: 'b2', user: { firstname: 'Bob', lastname: null, email: 'b@x', workspaceMemberships: [] } },
        ])
        p.subscriptionFreeze.findMany.mockResolvedValue([
            { userId: 'b1', untilDate: new Date('2026-10-30T00:00:00Z') },
        ])
        const out = await buildRoster(p as any, session, ALL)
        expect(
            p.subscriptionFreeze.findMany.mock.calls[0][0].where,
        ).toMatchObject({
            userId: { in: ['b1', 'b2'] },
            fromDate: { lte: new Date('2026-10-25T00:00:00Z') },
        })
        expect(out.expected.map((e) => [e.userId, e.frozenUntil])).toEqual([
            ['b1', '2026-10-30'],
            ['b2', null],
        ])
    })

    const flagSession = {
        id: 'sess1',
        workspaceId: 'w1',
        startAt: new Date('2026-10-24T16:00:00Z'),
        checkInCode: null,
        groupId: 'grp',
        slotId: 's1',
        occurrenceKey: 'slot:s1:2026-10-24',
        workspaceEventId: null,
        isPersonal: false,
    }
    const member = (userId: string) => ({
        userId,
        user: { firstname: userId, lastname: null, email: `${userId}@x` },
    })

    it('flags awaiting payment from one unpaid-subscriptions query (expired debts too); null without a member row', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue(
            ['unpaid', 'paid', 'expiredDebt', 'owner'].map(member),
        )
        p.workspaceMember.findMany.mockResolvedValue([
            { userId: 'unpaid' },
            { userId: 'paid' },
            { userId: 'expiredDebt' },
        ])
        // The query itself (awaitingPaymentWhere) is what includes EXPIRED rows.
        p.subscription.findMany.mockResolvedValue([
            { workspaceMember: { userId: 'unpaid' } },
            { workspaceMember: { userId: 'expiredDebt' } },
        ])
        const out = await buildRoster(p as any, flagSession, ALL)
        const by = Object.fromEntries(out.roster.map((r) => [r.userId, r.awaitingPayment]))
        expect(by).toEqual({
            unpaid: true,
            paid: false,
            expiredDebt: true,
            owner: null,
        })
        expect(p.subscription.findMany).toHaveBeenCalledTimes(1)
        expect(p.subscription.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            isPaid: false,
            status: { in: ['ACTIVE', 'EXPIRED'] },
            workspaceMember: {
                userId: { in: ['unpaid', 'paid', 'expiredDebt', 'owner'] },
            },
        })
        expect(p.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: { in: ['unpaid', 'paid', 'expiredDebt', 'owner'] },
        })
    })

    it('lets an own-groups-only coach open the card only for their own students', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany
            .mockResolvedValueOnce(['mine', 'other', 'owner'].map(member))
            .mockResolvedValueOnce([{ userId: 'mine' }])
        p.workspaceMember.findMany.mockResolvedValue([
            { userId: 'mine' },
            { userId: 'other' },
        ])
        const out = await buildRoster(p as any, flagSession, {
            userId: 'coach1',
            seesAllGroups: false,
        })
        expect(
            Object.fromEntries(out.roster.map((r) => [r.userId, r.canViewSubscription])),
        ).toEqual({ mine: true, other: false, owner: false })
        expect(p.groupMember.findMany.mock.calls[1][0].where).toEqual({
            userId: { in: ['mine', 'other', 'owner'] },
            group: {
                workspaceId: 'w1',
                coaches: { some: { userId: 'coach1' } },
            },
        })
    })

    it('lets a coach who sees all groups open every member row', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue(['a', 'owner'].map(member))
        p.workspaceMember.findMany.mockResolvedValue([{ userId: 'a' }])
        const out = await buildRoster(p as any, flagSession, ALL)
        expect(
            Object.fromEntries(out.roster.map((r) => [r.userId, r.canViewSubscription])),
        ).toEqual({ a: true, owner: false })
        expect(p.groupMember.findMany).toHaveBeenCalledTimes(1)
    })
})
