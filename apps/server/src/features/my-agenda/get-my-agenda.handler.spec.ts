import { BadRequestError } from '../../shared/errors/shared.errors'
import { GetMyAgendaFeature } from './get-my-agenda.feature'
import { GetMyAgendaHandler } from './get-my-agenda.handler'

const flags = (over: Record<string, boolean> = {}) => ({
    leaderboardEnabled: true,
    announcementsEnabled: true,
    ranksEnabled: true,
    attendanceEnabled: true,
    subscriptionEnabled: true,
    scheduleEnabled: true,
    groupsEnabled: true,
    eventsEnabled: true,
    guestVisitsEnabled: true,
    videosEnabled: true,
    achievementsEnabled: true,
    journalEnabled: true,
    ...over,
})

const club = (
    id: string,
    timezone: string,
    over: { accessUntil?: Date | null; ownerId?: string; flags?: Record<string, boolean> } = {},
) => ({
    accessUntil: over.accessUntil ?? null,
    workspace: {
        id,
        name: `Club ${id}`,
        timezone,
        ownerId: over.ownerId ?? 'owner',
        ...flags(over.flags),
        billing: null,
        moduleEntitlements: [],
    },
})

// Monday 19:00 weekly slot.
const slot = (id: string) => ({
    id,
    dayOfWeek: 1,
    startTime: '19:00',
    durationMin: 60,
    effectiveFrom: null,
    effectiveUntil: null,
})

const build = (
    o: {
        memberships?: unknown[]
        groups?: unknown[]
        bookings?: unknown[]
        events?: unknown[]
        trainings?: unknown[]
    } = {},
) => {
    const prisma = {
        workspaceMember: { findMany: jest.fn().mockResolvedValue(o.memberships ?? []) },
        group: { findMany: jest.fn().mockResolvedValue(o.groups ?? []) },
        dropInBooking: { findMany: jest.fn().mockResolvedValue(o.bookings ?? []) },
        workspaceEvent: { findMany: jest.fn().mockResolvedValue(o.events ?? []) },
        personalTrainingRequest: {
            findMany: jest.fn().mockResolvedValue(o.trainings ?? []),
        },
    }
    return { handler: new GetMyAgendaHandler(prisma as never), prisma }
}

const run = (h: GetMyAgendaHandler, from = '2026-11-02', to = '2026-11-08') =>
    h.execute(new GetMyAgendaFeature({ from, to }, 'u1'))

describe('getMyAgenda', () => {
    beforeAll(() => {
        jest.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z') })
    })
    afterAll(() => {
        jest.useRealTimers()
    })

    it('refuses a window that ends before it starts', async () => {
        const { handler } = build()
        await expect(run(handler, '2026-11-08', '2026-11-02')).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('refuses more than 14 days', async () => {
        const { handler, prisma } = build()
        await expect(run(handler, '2026-11-01', '2026-11-15')).rejects.toThrow(
            /максимум 14/,
        )
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it("reads only the caller's ACTIVE memberships of active clubs", async () => {
        const { handler, prisma } = build()
        await expect(run(handler)).resolves.toEqual({ items: [] })
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
            userId: 'u1',
            status: 'ACTIVE',
            workspace: { isActive: true },
        })
        expect(prisma.group.findMany).not.toHaveBeenCalled()
    })

    it('leaves out clubs whose access lapsed', async () => {
        const { handler, prisma } = build({
            memberships: [club('w1', 'UTC', { accessUntil: new Date('2026-10-01') })],
        })
        await expect(run(handler)).resolves.toEqual({ items: [] })
        expect(prisma.personalTrainingRequest.findMany).not.toHaveBeenCalled()
    })

    it('merges classes of two clubs in their own zones, sorted, tagged with the club', async () => {
        const { handler, prisma } = build({
            memberships: [club('w1', 'Europe/Moscow'), club('w2', 'Asia/Novosibirsk')],
            groups: [
                {
                    id: 'g1',
                    name: 'BJJ',
                    workspaceId: 'w1',
                    coachId: 'c1',
                    gym: null,
                    slots: [slot('s1')],
                    exceptions: [],
                    coaches: [],
                },
                {
                    id: 'g2',
                    name: 'Йога',
                    workspaceId: 'w2',
                    coachId: 'u1',
                    gym: { id: 'gym', name: 'Зал', timezone: null },
                    slots: [slot('s2')],
                    exceptions: [
                        {
                            slotId: null,
                            fromDate: new Date('2026-11-02T00:00:00Z'),
                            untilDate: new Date('2026-11-02T00:00:00Z'),
                            reason: 'Праздник',
                        },
                    ],
                    coaches: [],
                },
            ],
        })
        const { items } = await run(handler)
        expect(items.map((i) => [i.id, i.startAt, i.workspaceName, i.myRole, i.cancelled])).toEqual([
            ['class:s2:2026-11-02', '2026-11-02T12:00:00.000Z', 'Club w2', 'coach', true],
            ['class:s1:2026-11-02', '2026-11-02T16:00:00.000Z', 'Club w1', 'member', false],
        ])
        expect(items[0]).toMatchObject({
            kind: 'class',
            title: 'Йога',
            subtitle: 'Зал',
            timezone: 'Asia/Novosibirsk',
            date: '2026-11-02',
            cancellationReason: 'Праздник',
            groupId: 'g2',
            slotId: 's2',
            occurrenceId: 's2:2026-11-02',
            eventId: null,
            personalTrainingId: null,
        })
        const groupWhere = prisma.group.findMany.mock.calls[0][0].where
        expect(groupWhere.workspaceId).toEqual({ in: ['w1', 'w2'] })
        expect(groupWhere.OR).toEqual([
            { coachId: 'u1' },
            { coaches: { some: { userId: 'u1' } } },
            { members: { some: { userId: 'u1' } } },
        ])
    })

    it('marks an assistant coach as coach', async () => {
        const { handler } = build({
            memberships: [club('w1', 'UTC')],
            groups: [
                {
                    id: 'g1',
                    name: 'BJJ',
                    workspaceId: 'w1',
                    coachId: 'c1',
                    gym: null,
                    slots: [slot('s1')],
                    exceptions: [],
                    coaches: [{ userId: 'u1' }],
                },
            ],
        })
        expect((await run(handler)).items[0].myRole).toBe('coach')
    })

    it('skips the sections a club switched off', async () => {
        const { handler, prisma } = build({
            memberships: [
                club('w1', 'UTC', {
                    flags: {
                        scheduleEnabled: false,
                        eventsEnabled: false,
                        guestVisitsEnabled: false,
                    },
                }),
            ],
        })
        await run(handler)
        expect(prisma.group.findMany).not.toHaveBeenCalled()
        expect(prisma.workspaceEvent.findMany).not.toHaveBeenCalled()
        expect(prisma.dropInBooking.findMany).not.toHaveBeenCalled()
        expect(prisma.personalTrainingRequest.findMany).toHaveBeenCalled()
    })

    it('adds a booked drop-in at its slot time, and drops a slot that no longer runs', async () => {
        const group = { id: 'g9', name: 'Открытый ковёр', gym: null, exceptions: [] }
        const { handler } = build({
            memberships: [club('w1', 'Europe/Moscow')],
            bookings: [
                {
                    sessionDate: new Date('2026-11-02T00:00:00Z'),
                    workspaceId: 'w1',
                    slot: slot('s9'),
                    group,
                },
                {
                    sessionDate: new Date('2026-11-03T00:00:00Z'),
                    workspaceId: 'w1',
                    slot: slot('s9'),
                    group,
                },
            ],
        })
        const { items } = await run(handler)
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({
            id: 'dropIn:s9:2026-11-02',
            kind: 'dropIn',
            startAt: '2026-11-02T16:00:00.000Z',
            myRole: 'member',
            occurrenceId: 's9:2026-11-02',
        })
    })

    it('keeps events whose local day is in the window', async () => {
        const event = (id: string, startAt: string, timezone: string) => ({
            id,
            workspaceId: 'w1',
            title: `Event ${id}`,
            startAt: new Date(startAt),
            endAt: new Date(new Date(startAt).getTime() + 3_600_000),
            timezone,
            coachId: id === 'e1' ? 'u1' : null,
            gym: { id: 'gym', name: 'Зал', timezone: null },
        })
        const { handler } = build({
            memberships: [club('w1', 'UTC')],
            events: [
                event('e1', '2026-11-04T10:00:00Z', 'Europe/Moscow'),
                // 01:00 on the 9th in Novosibirsk: outside.
                event('e2', '2026-11-08T18:00:00Z', 'Asia/Novosibirsk'),
            ],
        })
        const { items } = await run(handler)
        expect(items).toEqual([
            expect.objectContaining({
                id: 'event:e1',
                kind: 'event',
                date: '2026-11-04',
                subtitle: 'Зал',
                myRole: 'coach',
                eventId: 'e1',
            }),
        ])
    })

    it('lists confirmed personal trainings from both sides', async () => {
        const person = (firstname: string) => ({ firstname, lastname: null, email: 'x@y.z' })
        const { handler, prisma } = build({
            memberships: [club('w1', 'UTC')],
            trainings: [
                {
                    id: 'pt1',
                    workspaceId: 'w1',
                    memberId: 'u1',
                    timezone: 'Europe/Moscow',
                    confirmedStartAt: new Date('2026-11-05T07:00:00Z'),
                    confirmedDurationMin: 45,
                    member: person('Я'),
                    coach: person('Тренер'),
                },
                {
                    id: 'pt2',
                    workspaceId: 'w1',
                    memberId: 'm2',
                    timezone: 'Europe/Moscow',
                    confirmedStartAt: new Date('2026-11-06T07:00:00Z'),
                    confirmedDurationMin: null,
                    member: person('Ученик'),
                    coach: person('Я'),
                },
                {
                    id: 'pt3',
                    workspaceId: 'w1',
                    memberId: 'u1',
                    timezone: 'Europe/Moscow',
                    confirmedStartAt: null,
                    confirmedDurationMin: null,
                    member: person('Я'),
                    coach: person('Тренер'),
                },
            ],
        })
        const { items } = await run(handler)
        expect(items.map((i) => [i.id, i.subtitle, i.myRole, i.endAt])).toEqual([
            ['personalTraining:pt1', 'Тренер', 'member', '2026-11-05T07:45:00.000Z'],
            ['personalTraining:pt2', 'Ученик', 'coach', '2026-11-06T08:00:00.000Z'],
        ])
        expect(prisma.personalTrainingRequest.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: { in: ['w1'] },
            status: 'CONFIRMED',
            OR: [{ memberId: 'u1' }, { coachId: 'u1' }],
        })
    })
})
