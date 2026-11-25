import { BadRequestError } from '../../shared/errors/shared.errors'
import { OrgConsentRequiredError } from './consent'
import {
    bookedCounts,
    bookOrgEvent,
    cancelOrgEventBooking,
    loadOrgEventRegistrations,
    OrgEventFullError,
    registrationClosedReason,
} from './org-events'

const now = new Date('2026-11-26T12:00:00Z')
const event = (o: Record<string, unknown> = {}) => ({
    id: 'e1',
    organizationId: 'org1',
    title: 'Открытый турнир',
    startAt: new Date('2026-12-20T03:00:00Z'),
    timezone: 'Asia/Tomsk',
    audience: 'STAFF_AND_MEMBERS' as const,
    publishedAt: new Date('2026-11-01T00:00:00Z'),
    registrationOpen: true,
    registrationClosesAt: null as Date | null,
    ...o,
})

// The transaction client is the mocked Prisma itself; the row lock is a
// $queryRaw returning the event's capacity.
const prismaWith = (o: {
    consented?: boolean
    capacity?: number | null
    existing?: unknown
    booked?: number
}) => {
    const prisma = {
        consentRecord: {
            findMany: jest
                .fn()
                .mockResolvedValue(o.consented === false ? [] : [{ userId: 'u1', dependentId: null }]),
        },
        guardianship: { findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([{ capacity: o.capacity ?? null }]),
        organizationEventRegistration: {
            findUnique: jest.fn().mockResolvedValue(o.existing ?? null),
            findUniqueOrThrow: jest.fn().mockResolvedValue(o.existing ?? null),
            count: jest.fn().mockResolvedValue(o.booked ?? 0),
            create: jest.fn(async ({ data }) => ({ id: 'r-new', ...data })),
            update: jest.fn(async ({ data }) => ({ id: 'r-old', ...data })),
        },
        $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    }
    return prisma
}

const book = (prisma: ReturnType<typeof prismaWith>, e = event()) =>
    bookOrgEvent(prisma as never, {
        event: e,
        workspaceId: 'w1',
        userId: 'u1',
        bookedById: 'u1',
        now,
    })

describe('org event registration rules', () => {
    it('explains every closed state', () => {
        expect(registrationClosedReason(event(), now)).toBeNull()
        expect(registrationClosedReason(event({ publishedAt: null }), now)).toMatch(/не опубликовано/)
        expect(
            registrationClosedReason(event({ publishedAt: new Date('2026-12-01Z') }), now),
        ).toMatch(/не опубликовано/)
        expect(registrationClosedReason(event({ registrationOpen: false }), now)).toMatch(/закрыта/)
        expect(
            registrationClosedReason(event({ registrationClosesAt: new Date('2026-11-25Z') }), now),
        ).toMatch(/закрыта/)
        expect(registrationClosedReason(event({ startAt: now }), now)).toMatch(/началось/)
    })

    it('books a consenting person under the event lock', async () => {
        const prisma = prismaWith({ capacity: 2, booked: 1 })
        const out = await book(prisma)
        expect(out.created).toBe(true)
        expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE')
        expect(prisma.organizationEventRegistration.create.mock.calls[0][0].data).toEqual({
            eventId: 'e1',
            userId: 'u1',
            workspaceId: 'w1',
            status: 'BOOKED',
            bookedById: 'u1',
            cancelledAt: null,
        })
    })

    it('refuses the place after the last one with «Мест нет»', async () => {
        const prisma = prismaWith({ capacity: 2, booked: 2 })
        await expect(book(prisma)).rejects.toBeInstanceOf(OrgEventFullError)
        await expect(book(prismaWith({ capacity: 2, booked: 2 }))).rejects.toMatchObject({
            code: 'ORG_EVENT_FULL',
            statusCode: 409,
        })
        expect(prisma.organizationEventRegistration.create).not.toHaveBeenCalled()
    })

    it('needs the consent first (409 ORG_CONSENT_REQUIRED)', async () => {
        const prisma = prismaWith({ consented: false })
        await expect(book(prisma)).rejects.toBeInstanceOf(OrgConsentRequiredError)
        await expect(book(prisma)).rejects.toMatchObject({ code: 'ORG_CONSENT_REQUIRED' })
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses a closed event before touching the lock', async () => {
        const prisma = prismaWith({})
        await expect(book(prisma, event({ registrationOpen: false }))).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns a live booking as is and books a cancelled one again in place', async () => {
        const live = { id: 'r-old', status: 'BOOKED' }
        const again = prismaWith({ existing: live, capacity: 1, booked: 1 })
        await expect(book(again)).resolves.toEqual({ registration: live, created: false })

        const cancelled = prismaWith({ existing: { id: 'r-old', status: 'CANCELLED' } })
        const out = await book(cancelled)
        expect(out.created).toBe(true)
        expect(cancelled.organizationEventRegistration.update.mock.calls[0][0]).toEqual({
            where: { id: 'r-old' },
            data: { workspaceId: 'w1', status: 'BOOKED', bookedById: 'u1', cancelledAt: null },
        })
    })

    it('cancels under the lock, once', async () => {
        const prisma = prismaWith({ existing: { id: 'r1', eventId: 'e1', status: 'BOOKED' } })
        await cancelOrgEventBooking(prisma as never, { registrationId: 'r1', now })
        expect(prisma.organizationEventRegistration.update.mock.calls[0][0].data).toEqual({
            status: 'CANCELLED',
            cancelledAt: now,
        })
        const done = prismaWith({ existing: { id: 'r1', eventId: 'e1', status: 'CANCELLED' } })
        await cancelOrgEventBooking(done as never, { registrationId: 'r1', now })
        expect(done.organizationEventRegistration.update).not.toHaveBeenCalled()
    })

    it('counts BOOKED places per event', async () => {
        const prisma = {
            organizationEventRegistration: {
                groupBy: jest.fn().mockResolvedValue([{ eventId: 'e1', _count: { _all: 3 } }]),
            },
        }
        await expect(bookedCounts(prisma as never, ['e1'])).resolves.toEqual(new Map([['e1', 3]]))
        expect(prisma.organizationEventRegistration.groupBy.mock.calls[0][0].where).toEqual({
            eventId: { in: ['e1'] },
            status: 'BOOKED',
        })
        await expect(bookedCounts(prisma as never, [])).resolves.toEqual(new Map())
    })
})

describe("the org's list of registrations", () => {
    const reg = (o: Record<string, unknown>) => ({
        id: 'r',
        userId: 'u',
        workspaceId: 'w1',
        status: 'BOOKED',
        bookedById: 'u',
        createdAt: new Date('2026-11-20T00:00:00Z'),
        user: { firstname: 'Иван', lastname: 'Иванов' },
        workspace: { name: 'ACADEMY', organizationLinks: [{ id: 'l1' }] },
        ...o,
    })

    it('names consenting people of ACTIVE clubs, counts the rest, and tells who booked', async () => {
        const prisma = {
            organizationEventRegistration: {
                findMany: jest.fn().mockResolvedValue([
                    reg({ id: 'self', userId: 'adult', bookedById: 'adult' }),
                    reg({ id: 'kid', userId: 'kid', bookedById: 'parent' }),
                    reg({ id: 'coach', userId: 'teen', bookedById: 'coach-1' }),
                    reg({ id: 'withdrawn', userId: 'gone' }),
                    reg({
                        id: 'left',
                        userId: 'adult2',
                        workspace: { name: 'Ушедший', organizationLinks: [] },
                    }),
                ]),
            },
            consentRecord: {
                findMany: jest.fn().mockResolvedValue([
                    { userId: 'adult', dependentId: null },
                    { userId: 'adult2', dependentId: null },
                    { userId: 'parent', dependentId: 'kid' },
                    { userId: 'teen', dependentId: null },
                ]),
            },
            guardianship: {
                findMany: jest.fn().mockResolvedValue([{ guardianId: 'parent', dependentId: 'kid' }]),
            },
            // No club shares its registry: no belts.
            organizationClub: { findMany: jest.fn().mockResolvedValue([]) },
            $queryRaw: jest.fn(),
        }
        const out = await loadOrgEventRegistrations(prisma as never, 'org1', 'e1')
        expect(out.hiddenCount).toBe(2)
        expect(out.rows.map((r) => [r.id, r.bookedBy, r.belt])).toEqual([
            ['self', 'SELF', null],
            ['kid', 'SELF', null],
            ['coach', 'COACH', null],
        ])
        expect(out.rows[0]).toMatchObject({ personName: 'Иван Иванов', clubName: 'ACADEMY' })
        expect(Object.keys(out.rows[0]).sort()).toEqual(
            ['belt', 'bookedBy', 'clubId', 'clubName', 'createdAt', 'id', 'personName', 'status'],
        )
    })
})
