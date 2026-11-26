import { OrgConsentRequiredError } from '../../../domains/organizations/consent'
import { OrgEventFullError } from '../../../domains/organizations/org-events'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { CancelOrgEventRegistrationFeature } from './cancel-org-event-registration.feature'
import { CancelOrgEventRegistrationHandler } from './cancel-org-event-registration.handler'
import { ListClubOrgEventsFeature } from './list-club-org-events.feature'
import { ListClubOrgEventsHandler } from './list-club-org-events.handler'
import { ListOrgEventStudentsFeature } from './list-org-event-students.feature'
import { ListOrgEventStudentsHandler } from './list-org-event-students.handler'
import { RegisterForOrgEventFeature } from './register-for-org-event.feature'
import { RegisterForOrgEventHandler } from './register-for-org-event.handler'

const W = 'w1'
const FUTURE = new Date(Date.now() + 10 * 24 * 3_600_000)

const eventRow = (o: Record<string, unknown> = {}) => ({
    id: 'e1',
    organizationId: 'org1',
    kind: 'COMPETITION',
    title: 'Открытый турнир',
    description: null,
    startAt: FUTURE,
    endAt: null,
    timezone: 'Asia/Tomsk',
    place: 'Олимп',
    address: null,
    audience: 'STAFF_AND_MEMBERS',
    capacity: 200,
    registrationOpen: true,
    registrationClosesAt: null,
    feeNote: 'Взнос 1 500 ₽ на месте',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    organization: { name: 'Федерация' },
    hostWorkspace: { name: 'ACADEMY' },
    ...o,
})

const makePrisma = (o: {
    event?: unknown
    consents?: Array<{ userId: string; dependentId: string | null }>
    booked?: number
    capacity?: number | null
    member?: unknown
    ownerId?: string
    registration?: unknown
    tournament?: { id: string; eventId: string; status: string } | null
    entries?: unknown[]
} = {}) => {
    const prisma = {
        workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: o.ownerId ?? 'owner' }) },
        organizationEvent: {
            findFirst: jest.fn().mockResolvedValue(o.event === undefined ? eventRow() : o.event),
            findMany: jest.fn().mockResolvedValue(o.event === undefined ? [eventRow()] : []),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(o.member === undefined ? { id: 'm1' } : o.member),
        },
        consentRecord: {
            findMany: jest.fn().mockResolvedValue(o.consents ?? [{ userId: 'stu', dependentId: null }]),
        },
        guardianship: { findMany: jest.fn().mockResolvedValue([]) },
        groupMember: { findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([{ capacity: o.capacity === undefined ? 200 : o.capacity }]),
        organizationEventRegistration: {
            findUnique: jest.fn().mockResolvedValue(o.registration ?? null),
            findUniqueOrThrow: jest.fn().mockResolvedValue(o.registration ?? null),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(o.booked ?? 0),
            groupBy: jest.fn().mockResolvedValue([{ eventId: 'e1', _count: { _all: (o.booked ?? 0) + 1 } }]),
            create: jest.fn(async ({ data }) => ({
                id: 'r1',
                updatedAt: new Date('2026-11-26T00:00:00Z'),
                ...data,
            })),
            update: jest.fn(async ({ data }) => ({ id: 'r1', ...data })),
        },
        tournament: {
            findMany: jest.fn().mockResolvedValue(o.tournament ? [o.tournament] : []),
            findUnique: jest.fn().mockResolvedValue(o.tournament ?? null),
        },
        tournamentEntry: {
            findMany: jest.fn().mockResolvedValue(o.entries ?? []),
            groupBy: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        tournamentDivision: { findMany: jest.fn().mockResolvedValue([]) },
        tournamentMatch: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    }
    return prisma
}

const makeRbac = (o: { coach?: boolean; ownStudent?: boolean } = {}) => ({
    resolveCoachScope: jest.fn(async () => {
        if (o.coach === false) throw new ForbiddenError({ message: 'Нужны права' })
        return { scope: 'coach_own_only', userId: 'coach', workspaceId: W }
    }),
    assertCanWriteMember: jest.fn(async () => {
        if (o.ownStudent === false) {
            throw new ForbiddenError({ message: 'Участник не состоит в ваших группах' })
        }
    }),
    canWriteAllGroups: jest.fn().mockReturnValue(false),
    ownGroupMemberIds: jest.fn().mockResolvedValue(['stu']),
})

const services = () => ({
    notifications: { notifyUser: jest.fn().mockResolvedValue(true) },
    realtime: { invalidate: jest.fn(), invalidateUsers: jest.fn() },
})

const register = (
    prisma: ReturnType<typeof makePrisma>,
    rbac: ReturnType<typeof makeRbac>,
    o: { invoker?: string; userId?: string; role?: string | null; guardianId?: string | null } = {},
) => {
    const s = services()
    const handler = new RegisterForOrgEventHandler(
        prisma as never,
        rbac as never,
        s.notifications as never,
        s.realtime as never,
    )
    return {
        ...s,
        result: handler.execute(
            new RegisterForOrgEventFeature(
                o.userId ? { userId: o.userId } : {},
                W,
                'e1',
                o.invoker ?? 'stu',
                o.guardianId ?? null,
                o.role === undefined ? 'user' : o.role,
                false,
            ),
        ),
    }
}

describe('registerForOrgEvent', () => {
    it('books a consenting member through this club and stays quiet', async () => {
        const prisma = makePrisma()
        const { result, notifications, realtime } = register(prisma, makeRbac())
        await expect(result).resolves.toEqual({
            id: 'r1',
            eventId: 'e1',
            status: 'BOOKED',
            bookedCount: 1,
        })
        // Only events visible to this club: ACTIVE link with the members switch.
        const where = prisma.organizationEvent.findFirst.mock.calls[0][0].where
        expect(where.OR[0].organization.clubs.some).toEqual({
            workspaceId: W,
            status: 'ACTIVE',
            allowMemberEvents: true,
        })
        expect(where.OR).toHaveLength(1)
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(realtime.invalidate).toHaveBeenCalledWith(W, ['organizations'])
    })

    it('records the guardian as the booker of a child', async () => {
        const prisma = makePrisma({ consents: [{ userId: 'kid', dependentId: null }] })
        const { result } = register(prisma, makeRbac(), { invoker: 'kid', guardianId: 'parent' })
        await result
        expect(prisma.organizationEventRegistration.create.mock.calls[0][0].data).toMatchObject({
            userId: 'kid',
            bookedById: 'parent',
        })
    })

    it('answers 404 when the club is not active in the org or the event is hidden', async () => {
        const { result } = register(makePrisma({ event: null }), makeRbac())
        await expect(result).rejects.toBeInstanceOf(NotFoundError)
    })

    it('needs the consent (409 ORG_CONSENT_REQUIRED)', async () => {
        const { result } = register(makePrisma({ consents: [] }), makeRbac())
        await expect(result).rejects.toBeInstanceOf(OrgConsentRequiredError)
    })

    it('refuses a full event and a closed one', async () => {
        const full = register(makePrisma({ capacity: 1, booked: 1 }), makeRbac())
        await expect(full.result).rejects.toBeInstanceOf(OrgEventFullError)
        const closed = register(
            makePrisma({ event: eventRow({ registrationOpen: false }) }),
            makeRbac(),
        )
        await expect(closed.result).rejects.toBeInstanceOf(BadRequestError)
        const started = register(
            makePrisma({ event: eventRow({ startAt: new Date(Date.now() - 1000) }) }),
            makeRbac(),
        )
        await expect(started.result).rejects.toBeInstanceOf(BadRequestError)
    })

    it('lets a coach book a consenting student of their groups and tells the student', async () => {
        const prisma = makePrisma()
        const rbac = makeRbac()
        const { result, notifications } = register(prisma, rbac, {
            invoker: 'coach',
            userId: 'stu',
            role: 'coach',
        })
        await result
        expect(rbac.assertCanWriteMember).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'coach_own_only' }),
            'stu',
        )
        expect(prisma.organizationEventRegistration.create.mock.calls[0][0].data).toMatchObject({
            userId: 'stu',
            bookedById: 'coach',
            workspaceId: W,
        })
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'stu',
                kind: 'org_event.registered_by_club',
                workspaceId: W,
                metadata: expect.objectContaining({ eventId: 'e1', organizationId: 'org1' }),
            }),
        )
    })

    it('refuses a coach a student of a foreign group (403) and a member booking others', async () => {
        const foreign = register(makePrisma(), makeRbac({ ownStudent: false }), {
            invoker: 'coach',
            userId: 'stu',
            role: 'coach',
        })
        await expect(foreign.result).rejects.toBeInstanceOf(ForbiddenError)
        const member = register(makePrisma(), makeRbac({ coach: false }), {
            invoker: 'stu2',
            userId: 'stu',
        })
        await expect(member.result).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses a coach a non-consenting student, a student who left, and a coaches-only event', async () => {
        const noConsent = register(makePrisma({ consents: [] }), makeRbac(), {
            invoker: 'coach',
            userId: 'stu',
            role: 'coach',
        })
        await expect(noConsent.result).rejects.toBeInstanceOf(OrgConsentRequiredError)
        const gone = register(makePrisma({ member: null }), makeRbac(), {
            invoker: 'coach',
            userId: 'stu',
            role: 'coach',
        })
        await expect(gone.result).rejects.toBeInstanceOf(NotFoundError)
        const staffOnly = register(
            makePrisma({ event: eventRow({ audience: 'STAFF' }) }),
            makeRbac(),
            { invoker: 'coach', userId: 'stu', role: 'coach' },
        )
        await expect(staffOnly.result).rejects.toBeInstanceOf(BadRequestError)
    })

    it('shows the club staff the coaches-only events too', async () => {
        const prisma = makePrisma({ consents: [{ userId: 'coach', dependentId: null }] })
        const { result } = register(prisma, makeRbac(), { invoker: 'coach', role: 'coach' })
        await result
        const where = prisma.organizationEvent.findFirst.mock.calls[0][0].where
        expect(where.OR[1]).toEqual({
            audience: 'STAFF',
            organization: { clubs: { some: { workspaceId: W, status: 'ACTIVE' } } },
        })
    })
})

describe('cancelOrgEventRegistration', () => {
    const run = (
        registration: unknown,
        invoker: string,
        tournament: { id: string; eventId: string; status: string } | null = null,
    ) => {
        const prisma = makePrisma({ registration, tournament })
        if (tournament) prisma.$queryRaw.mockResolvedValue([{ status: tournament.status }])
        const s = services()
        return {
            prisma,
            result: new CancelOrgEventRegistrationHandler(prisma as never, s.realtime as never).execute(
                new CancelOrgEventRegistrationFeature(W, 'r1', invoker, null),
            ),
        }
    }
    const reg = (o: Record<string, unknown> = {}) => ({
        id: 'r1',
        eventId: 'e1',
        userId: 'stu',
        workspaceId: W,
        bookedById: 'coach',
        status: 'BOOKED',
        event: { id: 'e1', startAt: FUTURE },
        ...o,
    })

    it('lets the person or the booking coach cancel', async () => {
        await expect(run(reg(), 'stu').result).resolves.toMatchObject({ status: 'CANCELLED' })
        await expect(run(reg(), 'coach').result).resolves.toMatchObject({ status: 'CANCELLED' })
    })

    it('hides it from anyone else and refuses after the start', async () => {
        await expect(run(reg(), 'stranger').result).rejects.toBeInstanceOf(NotFoundError)
        await expect(run(reg({ workspaceId: 'other' }), 'coach').result).rejects.toBeInstanceOf(
            NotFoundError,
        )
        await expect(run(null, 'stu').result).rejects.toBeInstanceOf(NotFoundError)
        await expect(
            run(reg({ event: { id: 'e1', startAt: new Date(Date.now() - 1000) } }), 'stu').result,
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('takes the SETUP entry with the registration and refuses once weigh-in started', async () => {
        const setup = run(reg(), 'stu', { id: 't1', eventId: 'e1', status: 'SETUP' })
        await expect(setup.result).resolves.toMatchObject({ status: 'CANCELLED' })
        expect(setup.prisma.tournamentEntry.deleteMany).toHaveBeenCalledWith({
            where: { registrationId: 'r1' },
        })
        const locked = run(reg(), 'stu', { id: 't1', eventId: 'e1', status: 'WEIGH_IN' })
        await expect(locked.result).rejects.toMatchObject({
            code: 'TOURNAMENT_LOCKED',
            statusCode: 409,
        })
        expect(locked.prisma.organizationEventRegistration.update).not.toHaveBeenCalled()
        expect(locked.prisma.tournamentEntry.deleteMany).not.toHaveBeenCalled()
    })
})

describe('listClubOrgEvents', () => {
    it('lists upcoming visible events with places and my booking', async () => {
        const prisma = makePrisma({ booked: 199 })
        prisma.organizationEventRegistration.findMany.mockResolvedValue([
            { id: 'r9', eventId: 'e1', status: 'BOOKED' },
        ])
        const out = await new ListClubOrgEventsHandler(prisma as never, makeRbac() as never).execute(
            new ListClubOrgEventsFeature(W, 'stu', 'user'),
        )
        expect(out.data[0]).toMatchObject({
            id: 'e1',
            organizationName: 'Федерация',
            hostClubName: 'ACADEMY',
            bookedCount: 200,
            registrationState: 'FULL',
            feeNote: 'Взнос 1 500 ₽ на месте',
            myRegistration: { id: 'r9', status: 'BOOKED' },
            tournament: null,
            myEntryState: null,
        })
    })

    it('adds the tournament line: «Укажите вес» for a booked member without an entry', async () => {
        const prisma = makePrisma({ tournament: { id: 't1', eventId: 'e1', status: 'SETUP' } })
        prisma.organizationEventRegistration.findMany.mockResolvedValue([
            { id: 'r9', eventId: 'e1', status: 'BOOKED', workspaceId: W },
        ])
        const rbac = makeRbac()
        const out = await new ListClubOrgEventsHandler(prisma as never, rbac as never).execute(
            new ListClubOrgEventsFeature(W, 'stu', 'user'),
        )
        expect(out.data[0].tournament).toEqual({ id: 't1', status: 'SETUP', toConfirmCount: null })
        expect(out.data[0].myEntryState).toMatchObject({ state: 'NEEDS_WEIGHT' })
        // A member is no coach: no scope asked, no count.
        expect(rbac.resolveCoachScope).not.toHaveBeenCalled()
    })

    it('shows the entry state, and the own-scope count to the club staff', async () => {
        const prisma = makePrisma({
            tournament: { id: 't1', eventId: 'e1', status: 'SETUP' },
            entries: [
                { id: 'en1', tournamentId: 't1', status: 'DECLARED', place: null, division: null },
            ],
        })
        prisma.organizationEventRegistration.findMany.mockResolvedValue([
            { id: 'r9', eventId: 'e1', status: 'BOOKED', workspaceId: W },
        ])
        prisma.tournamentEntry.groupBy.mockResolvedValue([{ tournamentId: 't1', _count: { _all: 3 } }])
        const rbac = makeRbac()
        const out = await new ListClubOrgEventsHandler(prisma as never, rbac as never).execute(
            new ListClubOrgEventsFeature(W, 'coach', 'coach'),
        )
        expect(out.data[0].tournament).toEqual({ id: 't1', status: 'SETUP', toConfirmCount: 3 })
        expect(out.data[0].myEntryState).toMatchObject({ state: 'AWAITING_COACH' })
        // Own students only (coach scope).
        expect(prisma.tournamentEntry.groupBy.mock.calls[0][0].where).toMatchObject({
            workspaceId: W,
            status: 'DECLARED',
            userId: { in: ['stu'] },
        })
    })

    it('marks a closed event and an open one', async () => {
        const prisma = makePrisma()
        prisma.organizationEvent.findMany.mockResolvedValue([
            eventRow({ id: 'e1' }),
            eventRow({ id: 'e2', registrationOpen: false }),
        ])
        prisma.organizationEventRegistration.groupBy.mockResolvedValue([])
        const out = await new ListClubOrgEventsHandler(prisma as never, makeRbac() as never).execute(
            new ListClubOrgEventsFeature(W, 'owner', null),
        )
        expect(out.data.map((e) => e.registrationState)).toEqual(['OPEN', 'CLOSED'])
        // The owner (no member row) counts as staff.
        expect(prisma.organizationEvent.findMany.mock.calls[0][0].where.AND[0].OR).toHaveLength(2)
    })
})

describe('listOrgEventStudents', () => {
    it("lists a coach's own-group active students with consent and booking", async () => {
        const prisma = makePrisma({ consents: [{ userId: 'a', dependentId: null }] })
        prisma.groupMember.findMany.mockResolvedValue([
            { user: { id: 'b', firstname: 'Борис', lastname: null } },
            { user: { id: 'a', firstname: 'Анна', lastname: null } },
            { user: { id: 'c', firstname: 'Вера', lastname: null } },
        ])
        prisma.organizationEventRegistration.findMany.mockResolvedValue([
            // Booked by this coach here: cancellable.
            { id: 'r1', userId: 'a', status: 'BOOKED', workspaceId: W, bookedById: 'coach' },
            // Self-booked: the coach can't give the place back.
            { id: 'r2', userId: 'c', status: 'BOOKED', workspaceId: W, bookedById: 'c' },
        ])
        const rbac = makeRbac()
        const out = await new ListOrgEventStudentsHandler(prisma as never, rbac as never).execute(
            new ListOrgEventStudentsFeature(W, 'e1', 'coach', 'coach', false),
        )
        expect(out.data).toEqual([
            {
                userId: 'a',
                name: 'Анна',
                consented: true,
                registration: { id: 'r1', status: 'BOOKED', canCancel: true },
            },
            { userId: 'b', name: 'Борис', consented: false, registration: null },
            {
                userId: 'c',
                name: 'Вера',
                consented: false,
                registration: { id: 'r2', status: 'BOOKED', canCancel: false },
            },
        ])
        const where = prisma.groupMember.findMany.mock.calls[0][0].where
        expect(where.group.workspaceId).toBe(W)
        expect(where.group.OR).toBeDefined()
    })

    it('refuses a member', async () => {
        await expect(
            new ListOrgEventStudentsHandler(makePrisma() as never, makeRbac({ coach: false }) as never).execute(
                new ListOrgEventStudentsFeature(W, 'e1', 'stu', 'user', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})
