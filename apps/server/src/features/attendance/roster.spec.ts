import { ownGroupsWhere } from '../../shared/services/rbac.service'
import { buildRoster } from './roster'

const ALL = { userId: 'coach1', seesAllGroups: true }
const LIVE = new Date(Date.now() + 30 * 24 * 3600 * 1000)

const dir = (id: string) => ({
    directionId: id,
    direction: { id, name: id.toUpperCase(), color: null, icon: null },
})

// A current abonement as loadVisitCandidates reads it.
const sub = (
    userId: string,
    id: string,
    over: {
        classesTotal?: number | null
        classesRemaining?: number | null
        directions?: string[]
        frozen?: boolean
    } = {},
) => ({
    id,
    status: 'ACTIVE',
    startDate: null,
    endDate: LIVE,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    classesTotal: over.classesTotal === undefined ? 10 : over.classesTotal,
    classesRemaining:
        over.classesRemaining === undefined ? 5 : over.classesRemaining,
    startsOnFirstVisit: false,
    plan: { name: `Plan ${id}` },
    workspaceMember: { userId },
    directions: (over.directions ?? []).map(dir),
    freezes: over.frozen ? [{ id: 'fr' }] : [],
})
const visitAbonement = (
    id: string,
    classesRemaining: number | null = 5,
    directions: string[] = [],
) => ({
    subscriptionId: id,
    planName: `Plan ${id}`,
    classesTotal: classesRemaining === null ? null : 10,
    classesRemaining,
    endDate: LIVE.toISOString(),
    directions: directions.map((d) => dir(d).direction),
})

type SubsWhere = {
    isPaid?: boolean
    id?: { in: string[] }
    workspaceMember?: { userId?: { in: string[] } }
}

// subscription.findMany serves three lookups, told apart by their filter:
// unpaid (awaiting payment), by id (used abonements), current (candidates).
const makePrisma = (
    o: { current?: unknown[]; used?: unknown[]; unpaid?: unknown[] } = {},
) => ({
    attendanceRecord: { findMany: jest.fn() },
    attendanceSession: { findUnique: jest.fn() },
    groupMember: { findMany: jest.fn() },
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
    classBooking: { findMany: jest.fn().mockResolvedValue([]) },
    // A fixed group unless a test says otherwise.
    group: { findUnique: jest.fn().mockResolvedValue({ bookingMode: 'FIXED', capacity: null }) },
    groupScheduleSlot: { findUnique: jest.fn().mockResolvedValue({ capacity: null }) },
    classOccurrence: { findUnique: jest.fn().mockResolvedValue(null) },
    // Events are free (they count like a class) unless a test prices one.
    workspaceEvent: { findUnique: jest.fn().mockResolvedValue({ price: null }) },
    eventRegistration: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn() },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    subscription: {
        findMany: jest.fn(async ({ where }: { where: SubsWhere }) => {
            if (where.isPaid === false) return o.unpaid ?? []
            if (where.id) return o.used ?? []
            const ids = where.workspaceMember?.userId?.in ?? []
            return (
                (o.current ?? []) as Array<{ workspaceMember: { userId: string } }>
            ).filter((s) => ids.includes(s.workspaceMember.userId))
        }),
    },
    subscriptionFreeze: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
    },
})
const callsWhere = (p: ReturnType<typeof makePrisma>, pick: (w: SubsWhere) => boolean) =>
    p.subscription.findMany.mock.calls.filter(([a]) => pick(a.where))

const member = (userId: string) => ({
    userId,
    user: { firstname: userId, lastname: null, email: `${userId}@x` },
})

const groupSession = {
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

describe('buildRoster — group session', () => {
    it('pre-populates group members with present flags and adds guests', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([
            { userId: 'm1', isGuest: false, usedSubscriptionId: null },
            { userId: 'g9', isGuest: true, usedSubscriptionId: null },
        ])
        p.groupMember.findMany.mockResolvedValue([
            { userId: 'm1', user: { firstname: 'Ann', lastname: null, email: 'a@x' } },
            { userId: 'm2', user: { firstname: null, lastname: null, email: 'm2@x' } },
        ])
        p.user.findMany.mockResolvedValue([
            { id: 'g9', firstname: 'Guest', lastname: null, email: 'g@x' },
        ])
        const out = await buildRoster(p as any, groupSession, ALL)
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
            { userId: 'b2', isGuest: true, usedSubscriptionId: null },
        ])
        p.groupMember.findMany.mockResolvedValue([])
        p.user.findMany.mockResolvedValue([
            { id: 'b2', firstname: 'Bob', lastname: null, email: 'b@x' },
        ])
        p.dropInBooking.findMany.mockResolvedValue([
            { userId: 'b1', user: { firstname: 'Ann', lastname: null, email: 'a@x' } },
            { userId: 'b2', user: { firstname: 'Bob', lastname: null, email: 'b@x' } },
        ])
        const out = await buildRoster(p as any, groupSession, ALL)
        const none = {
            frozenUntil: null,
            classesLeft: null,
            abonement: null,
            abonementOptions: [],
        }
        expect(out.expected).toEqual([
            { userId: 'b1', displayName: 'Ann', present: false, source: 'booking', ...none },
            { userId: 'b2', displayName: 'Bob', present: true, source: 'booking', ...none },
        ])
    })
})

describe('buildRoster — «Запись на занятие» class', () => {
    it('lists the bookings instead of the group, with places and the waitlist', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.user.findMany.mockResolvedValue([])
        p.group.findUnique.mockResolvedValue({ bookingMode: 'BOOKING', capacity: 12 })
        p.groupScheduleSlot.findUnique.mockResolvedValue({ capacity: 8 })
        const at = (d: string) => new Date(`2026-10-2${d}T10:00:00Z`)
        p.classOccurrence.findUnique.mockResolvedValue({
            capacity: null,
            bookings: [
                { id: 'b1', userId: 'm1', status: 'BOOKED', createdAt: at('0'), user: { firstname: 'Ann', lastname: null, email: null } },
                { id: 'w2', userId: 'w2', status: 'WAITLISTED', createdAt: at('2'), user: { firstname: 'Wes', lastname: null, email: null } },
                { id: 'w1', userId: 'w1', status: 'WAITLISTED', createdAt: at('1'), user: { firstname: 'Val', lastname: null, email: null } },
            ],
        })
        p.classBooking.findMany.mockResolvedValue([
            { userId: 'm1', user: { firstname: 'Ann', lastname: null, email: null } },
        ])
        const out = await buildRoster(p as any, groupSession, ALL)
        // The group's members are not the class list.
        expect(p.groupMember.findMany).not.toHaveBeenCalled()
        expect(out.roster).toEqual([])
        expect(out.expected).toEqual([
            expect.objectContaining({ userId: 'm1', source: 'booking', present: false }),
        ])
        expect(out.booking).toEqual({
            capacity: 8,
            booked: 1,
            waitlist: [
                { userId: 'w1', displayName: 'Val', position: 1 },
                { userId: 'w2', displayName: 'Wes', position: 2 },
            ],
        })
    })

    it('a fixed group has no booking block', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([member('m1')])
        const out = await buildRoster(p as any, groupSession, ALL)
        expect(out.booking).toBeNull()
        expect(p.classOccurrence.findUnique).not.toHaveBeenCalled()
    })
})

describe('buildRoster — event session', () => {
    it('returns marked attendees only with isGuest null', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([
            { userId: 'a1', isGuest: null, usedSubscriptionId: null },
        ])
        p.user.findMany.mockResolvedValue([
            { id: 'a1', firstname: 'Ivan', lastname: 'P', email: 'i@x' },
        ])
        const out = await buildRoster(p as any, {
            ...groupSession,
            id: 'sess2',
            groupId: null,
            slotId: null,
            occurrenceKey: 'event:e1',
            workspaceEventId: 'e1',
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
                abonement: null,
                abonementOptions: [],
            },
        ])
    })
})

describe('buildRoster — personal session', () => {
    it('reports kind personal and the one member as expected, never touching abonements', async () => {
        const p = makePrisma({ current: [sub('m1', 'sub1')] }) as any
        p.personalTrainingRequest = {
            findUnique: jest.fn().mockResolvedValue({
                memberId: 'm1',
                member: { firstname: 'Ann', lastname: null, email: 'a@x' },
            }),
        }
        p.attendanceRecord.findMany.mockResolvedValue([])
        const out = await buildRoster(p, {
            ...groupSession,
            id: 'sess3',
            groupId: null,
            slotId: null,
            occurrenceKey: 'personal:r1',
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
                abonement: null,
                abonementOptions: [],
            }),
        ])
        expect(p.subscription.findMany).not.toHaveBeenCalled()
    })
})

describe('buildRoster — abonements', () => {
    it('loads every row’s abonements in one query (roster and booked guests together)', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([member('m1'), member('m2')])
        p.dropInBooking.findMany.mockResolvedValue([
            { userId: 'b1', user: { firstname: 'B', lastname: null, email: 'b@x' } },
        ])
        await buildRoster(p as any, groupSession, ALL)
        const current = callsWhere(p, (w) => !!w.workspaceMember && w.isPaid === undefined)
        expect(current).toHaveLength(1)
        expect(current[0][0].where.workspaceMember).toEqual({
            userId: { in: ['m1', 'm2', 'b1'] },
        })
        // Nobody present: no used-abonement lookup.
        expect(callsWhere(p, (w) => !!w.id)).toHaveLength(0)
    })

    it('offers what a mark would use now, in precedence order, to a member not marked yet', async () => {
        const p = makePrisma({
            current: [
                sub('m1', 'club', { classesTotal: null, classesRemaining: null }),
                sub('m1', 'bjj', { directions: ['bjj'] }),
                sub('m1', 'mma', { directions: ['mma'] }),
            ],
        })
        p.attendanceSession.findUnique.mockResolvedValue({
            group: { directionId: 'bjj' },
            workspaceEvent: null,
        })
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([member('m1')])
        const out = await buildRoster(p as any, groupSession, ALL)
        const row = out.roster[0]
        expect(row.abonement).toEqual(visitAbonement('bjj', 5, ['bjj']))
        expect(row.abonementOptions.map((a) => a.subscriptionId)).toEqual(['bjj', 'club'])
    })

    it('shows the abonement a present visit was attributed to, even when it is no longer eligible', async () => {
        const used = {
            id: 'bjj',
            classesTotal: 10,
            classesRemaining: 0,
            endDate: LIVE,
            plan: { name: 'Plan bjj' },
            directions: [{ direction: dir('bjj').direction }],
        }
        const p = makePrisma({
            current: [
                sub('m1', 'bjj', { directions: ['bjj'], classesRemaining: 0 }),
                sub('m1', 'club', { classesTotal: null, classesRemaining: null }),
            ],
            used: [used],
        })
        p.attendanceSession.findUnique.mockResolvedValue({
            group: { directionId: 'bjj' },
            workspaceEvent: null,
        })
        p.attendanceRecord.findMany.mockResolvedValue([
            { userId: 'm1', isGuest: false, usedSubscriptionId: 'bjj' },
            { userId: 'm2', isGuest: false, usedSubscriptionId: null },
        ])
        p.groupMember.findMany.mockResolvedValue([member('m1'), member('m2')])
        const out = await buildRoster(p as any, groupSession, ALL)
        expect(callsWhere(p, (w) => !!w.id)[0][0].where).toEqual({ id: { in: ['bjj'] } })
        const m1 = out.roster.find((r) => r.userId === 'm1')!
        expect(m1.abonement).toEqual(visitAbonement('bjj', 0, ['bjj']))
        // The used one first, then the others it could be moved to.
        expect(m1.abonementOptions.map((a) => a.subscriptionId)).toEqual(['bjj', 'club'])
        // Present without attribution: nothing paid.
        const m2 = out.roster.find((r) => r.userId === 'm2')!
        expect(m2.abonement).toBeNull()
        expect(m2.abonementOptions).toEqual([])
    })

    it('reports a booked guest’s classes left on the abonement that would pay, 0 when only a used-up pack covers the class', async () => {
        const p = makePrisma({
            current: [
                sub('b1', 'p1', { classesRemaining: 3 }),
                sub('b2', 'p2', { classesRemaining: 0 }),
                sub('b3', 't3', { classesTotal: null, classesRemaining: null }),
            ],
        })
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([])
        p.dropInBooking.findMany.mockResolvedValue(
            ['b1', 'b2', 'b3', 'b4'].map((userId) => ({
                userId,
                user: { firstname: userId, lastname: null, email: `${userId}@x` },
            })),
        )
        const out = await buildRoster(p as any, groupSession, ALL)
        expect(out.expected.map((e) => [e.userId, e.classesLeft, e.abonement?.subscriptionId ?? null])).toEqual([
            ['b1', 3, 'p1'],
            ['b2', 0, null],
            ['b3', null, 't3'],
            ['b4', null, null],
        ])
    })
})

describe('buildRoster — frozen abonement badge', () => {
    const session = {
        ...groupSession,
        occurrenceKey: 'slot:s1:2026-10-25',
        // 02:00 Moscow on the 25th: the club day is the 25th, not the UTC 24th.
        startAt: new Date('2026-10-24T23:00:00Z'),
    }

    it('fills frozenUntil from a freeze of a current abonement covering the session day', async () => {
        const p = makePrisma({ current: [sub('m1', 'sub1', { frozen: true })] })
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([member('m1'), member('m2')])
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
                subscription: {
                    NOT: { workspaceMemberId: null },
                    status: 'ACTIVE',
                    OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
                },
            },
            select: { userId: true, untilDate: true },
        })
        expect(out.roster.find((r) => r.userId === 'm1')?.frozenUntil).toBe('2026-10-30')
        expect(out.roster.find((r) => r.userId === 'm2')?.frozenUntil).toBeNull()
        // The same club day decides which candidates are frozen.
        const current = callsWhere(p, (w) => !!w.workspaceMember && w.isPaid === undefined)
        expect(current[0][0].select.freezes.where).toEqual({
            fromDate: { lte: new Date('2026-10-25T00:00:00Z') },
            untilDate: { gte: new Date('2026-10-25T00:00:00Z') },
        })
    })

    it('shows no badge while another unfrozen abonement can pay for the class', async () => {
        const p = makePrisma({
            current: [
                sub('m1', 'bjj', { directions: ['bjj'], frozen: true }),
                sub('m1', 'club'),
            ],
        })
        p.attendanceSession.findUnique.mockResolvedValue({
            group: { directionId: 'bjj' },
            workspaceEvent: null,
        })
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([member('m1')])
        p.subscriptionFreeze.findMany.mockResolvedValue([
            { userId: 'm1', untilDate: new Date('2026-10-30T00:00:00Z') },
        ])
        const out = await buildRoster(p as any, session, ALL)
        expect(out.roster[0].frozenUntil).toBeNull()
        expect(out.roster[0].abonement?.subscriptionId).toBe('club')
    })

    it('reports the latest freeze end when several abonements are frozen', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([member('m1')])
        p.subscriptionFreeze.findMany.mockResolvedValue([
            { userId: 'm1', untilDate: new Date('2026-10-30T00:00:00Z') },
            { userId: 'm1', untilDate: new Date('2026-11-04T00:00:00Z') },
        ])
        const out = await buildRoster(p as any, session, ALL)
        expect(out.roster[0].frozenUntil).toBe('2026-11-04')
    })

    it('uses the workspace timezone even if the session carries another one', async () => {
        const p = makePrisma()
        p.workspace.findUnique.mockResolvedValue({ timezone: 'America/New_York' })
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([member('m1')])
        await buildRoster(p as any, { ...session, timezone: 'Europe/Moscow' } as any, ALL)
        // 23:00Z on the 24th is the 25th in Moscow but still the 24th (19:00)
        // in the club's New York calendar.
        expect(
            p.subscriptionFreeze.findMany.mock.calls[0][0].where.fromDate,
        ).toEqual({ lte: new Date('2026-10-24T00:00:00Z') })
    })

    it('skips the lookups for an empty roster', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([])
        await buildRoster(p as any, session, ALL)
        expect(p.subscriptionFreeze.findMany).not.toHaveBeenCalled()
        expect(p.subscription.findMany).not.toHaveBeenCalled()
    })

    it('badges a booked guest whose abonement is frozen on the class day', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue([])
        p.dropInBooking.findMany.mockResolvedValue([
            { userId: 'b1', user: { firstname: 'Ann', lastname: null, email: 'a@x' } },
            { userId: 'b2', user: { firstname: 'Bob', lastname: null, email: 'b@x' } },
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
})

describe('buildRoster — payment and card flags', () => {
    it('flags awaiting payment from one unpaid-subscriptions query (expired debts too); null without a member row', async () => {
        const p = makePrisma({
            // The query itself (awaitingPaymentWhere) is what includes EXPIRED rows.
            unpaid: [
                { workspaceMember: { userId: 'unpaid' } },
                { workspaceMember: { userId: 'expiredDebt' } },
            ],
        })
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue(
            ['unpaid', 'paid', 'expiredDebt', 'owner'].map(member),
        )
        p.workspaceMember.findMany.mockResolvedValue([
            { userId: 'unpaid' },
            { userId: 'paid' },
            { userId: 'expiredDebt' },
        ])
        const out = await buildRoster(p as any, groupSession, ALL)
        const by = Object.fromEntries(out.roster.map((r) => [r.userId, r.awaitingPayment]))
        expect(by).toEqual({
            unpaid: true,
            paid: false,
            expiredDebt: true,
            owner: null,
        })
        const unpaid = callsWhere(p, (w) => w.isPaid === false)
        expect(unpaid).toHaveLength(1)
        expect(unpaid[0][0].where).toEqual({
            workspaceId: 'w1',
            isPaid: false,
            status: { in: ['ACTIVE', 'EXPIRED'] },
            NOT: { workspaceMemberId: null },
            workspaceMember: {
                userId: { in: ['unpaid', 'paid', 'expiredDebt', 'owner'] },
            },
        })
        expect(p.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: { in: ['unpaid', 'paid', 'expiredDebt', 'owner'] },
        })
    })

    it('lets an own-groups-only coach open the card only for their own students (coached or of a managed direction)', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany
            .mockResolvedValueOnce(['mine', 'other', 'owner'].map(member))
            .mockResolvedValueOnce([{ userId: 'mine' }])
        p.workspaceMember.findMany.mockResolvedValue([
            { userId: 'mine' },
            { userId: 'other' },
        ])
        const out = await buildRoster(p as any, groupSession, {
            userId: 'coach1',
            seesAllGroups: false,
        })
        expect(
            Object.fromEntries(out.roster.map((r) => [r.userId, r.canViewSubscription])),
        ).toEqual({ mine: true, other: false, owner: false })
        expect(p.groupMember.findMany.mock.calls[1][0].where).toEqual({
            userId: { in: ['mine', 'other', 'owner'] },
            group: { workspaceId: 'w1', ...ownGroupsWhere('coach1') },
        })
    })

    it('lets a coach who sees all groups open every member row', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([])
        p.groupMember.findMany.mockResolvedValue(['a', 'owner'].map(member))
        p.workspaceMember.findMany.mockResolvedValue([{ userId: 'a' }])
        const out = await buildRoster(p as any, groupSession, ALL)
        expect(
            Object.fromEntries(out.roster.map((r) => [r.userId, r.canViewSubscription])),
        ).toEqual({ a: true, owner: false })
        expect(p.groupMember.findMany).toHaveBeenCalledTimes(1)
    })
})
