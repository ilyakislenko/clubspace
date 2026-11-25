jest.mock('../../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))

import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { CreateOrgEventFeature } from './create-org-event.feature'
import { CreateOrgEventHandler } from './create-org-event.handler'
import { DeleteOrgEventFeature } from './delete-org-event.feature'
import { DeleteOrgEventHandler } from './delete-org-event.handler'
import { GetOrgEventFeature } from './get-org-event.feature'
import { GetOrgEventHandler } from './get-org-event.handler'
import { ListOrgEventRegistrationsFeature } from './list-org-event-registrations.feature'
import { ListOrgEventRegistrationsHandler } from './list-org-event-registrations.handler'
import { ListOrgEventsFeature } from './list-org-events.feature'
import { ListOrgEventsHandler } from './list-org-events.handler'
import { UpdateOrgEventFeature } from './update-org-event.feature'
import { UpdateOrgEventHandler } from './update-org-event.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const HOST = '22222222-2222-4222-8222-222222222222'
const orgRbac = (role: 'ORG_ADMIN' | 'ORG_COACH' = 'ORG_COACH') => ({
    resolveOrgScope: jest.fn(async (c: object) => ({ ...c, role })),
})
const stored = (o: Record<string, unknown> = {}) => ({
    id: 'e1',
    organizationId: ORG,
    kind: 'COMPETITION',
    title: 'Открытый турнир',
    description: null,
    startAt: new Date('2026-12-20T03:00:00Z'),
    endAt: null,
    timezone: 'Asia/Tomsk',
    place: null,
    address: null,
    hostWorkspace: null,
    audience: 'STAFF_AND_MEMBERS',
    capacity: 200,
    registrationOpen: true,
    registrationClosesAt: null,
    feeNote: null,
    publishedAt: new Date('2026-11-26T00:00:00Z'),
    createdAt: new Date('2026-11-26T00:00:00Z'),
    updatedAt: new Date('2026-11-26T00:00:00Z'),
    ...o,
})

const makePrisma = (o: { current?: unknown; activeClubs?: string[] } = {}) => {
    const prisma = {
        organization: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }) },
        organizationClub: {
            findMany: jest
                .fn()
                .mockResolvedValue((o.activeClubs ?? [HOST]).map((workspaceId) => ({ workspaceId }))),
        },
        organizationEvent: {
            create: jest.fn(async ({ data }) => stored({ ...data, hostWorkspace: data.hostWorkspaceId ? { id: HOST, name: 'ACADEMY' } : null })),
            findFirst: jest.fn().mockResolvedValue(o.current === undefined ? stored() : o.current),
            findMany: jest.fn().mockResolvedValue([stored()]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn(async ({ data }) => stored(data)),
            delete: jest.fn().mockResolvedValue({}),
        },
        organizationEventRegistration: {
            groupBy: jest.fn().mockResolvedValue([{ eventId: 'e1', _count: { _all: 23 } }]),
            findMany: jest.fn().mockResolvedValue([]),
        },
        consentRecord: { findMany: jest.fn().mockResolvedValue([]) },
        guardianship: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    }
    return prisma
}
const audit = () => ({ record: jest.fn() })

describe('createOrgEvent', () => {
    it('stores the wall clock in the org zone, the host club and the fee note', async () => {
        const prisma = makePrisma()
        const a = audit()
        const out = await new CreateOrgEventHandler(prisma as never, orgRbac() as never, a as never).execute(
            new CreateOrgEventFeature(
                {
                    kind: 'COMPETITION',
                    title: 'Открытый турнир',
                    startAt: '2026-12-20T10:00',
                    endAt: '2026-12-20T18:00',
                    hostClubId: HOST,
                    capacity: 200,
                    feeNote: 'Взнос 1 500 ₽ на месте',
                    registrationClosesAt: '2026-12-18T23:59',
                },
                ORG,
                'u1',
                false,
            ),
        )
        const data = prisma.organizationEvent.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            organizationId: ORG,
            timezone: 'Asia/Tomsk',
            startAt: new Date('2026-12-20T03:00:00Z'),
            endAt: new Date('2026-12-20T11:00:00Z'),
            registrationClosesAt: new Date('2026-12-18T16:59:00Z'),
            hostWorkspaceId: HOST,
            audience: 'STAFF_AND_MEMBERS',
            feeNote: 'Взнос 1 500 ₽ на месте',
            createdById: 'u1',
        })
        expect(data.publishedAt).toBeInstanceOf(Date)
        expect(out).toMatchObject({ hostClub: { id: HOST, name: 'ACADEMY' }, bookedCount: 0 })
        expect(a.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'org.eventCreate', organizationId: ORG }),
        )
    })

    it('refuses a host outside the org, an end before the start and an unknown zone', async () => {
        const run = (payload: Record<string, unknown>, prisma = makePrisma()) =>
            new CreateOrgEventHandler(prisma as never, orgRbac() as never, audit() as never).execute(
                new CreateOrgEventFeature(
                    { title: 'x', startAt: '2026-12-20T10:00', ...payload },
                    ORG,
                    'u1',
                    false,
                ),
            )
        await expect(run({ hostClubId: HOST }, makePrisma({ activeClubs: [] }))).rejects.toBeInstanceOf(
            BadRequestError,
        )
        await expect(run({ endAt: '2026-12-20T09:00' })).rejects.toBeInstanceOf(BadRequestError)
        await expect(run({ timezone: 'Mars/Base' })).rejects.toBeInstanceOf(BadRequestError)
    })

    it('keeps a draft with publish=false', async () => {
        const prisma = makePrisma()
        await new CreateOrgEventHandler(prisma as never, orgRbac() as never, audit() as never).execute(
            new CreateOrgEventFeature(
                { title: 'x', startAt: '2026-12-20T10:00', publish: false },
                ORG,
                'u1',
                false,
            ),
        )
        expect(prisma.organizationEvent.create.mock.calls[0][0].data.publishedAt).toBeNull()
    })
})

describe('updateOrgEvent', () => {
    const run = (payload: Record<string, unknown>, prisma = makePrisma()) =>
        new UpdateOrgEventHandler(prisma as never, orgRbac() as never, audit() as never).execute(
            new UpdateOrgEventFeature(payload as never, ORG, 'e1', 'u1', false),
        )

    it('keeps the typed time when only the zone changes', async () => {
        const prisma = makePrisma()
        await run({ timezone: 'Europe/Moscow' }, prisma)
        // 10:00 Tomsk stays 10:00, now in Moscow.
        expect(prisma.organizationEvent.update.mock.calls[0][0].data).toMatchObject({
            timezone: 'Europe/Moscow',
            startAt: new Date('2026-12-20T07:00:00Z'),
        })
    })

    it('changes capacity and unpublishes', async () => {
        const prisma = makePrisma()
        const out = await run({ capacity: 10, publish: false }, prisma)
        expect(prisma.organizationEvent.update.mock.calls[0][0].data).toMatchObject({
            capacity: 10,
            publishedAt: null,
        })
        expect(out.bookedCount).toBe(23)
    })

    it('answers 404 for an event of another org', async () => {
        await expect(run({ title: 'x' }, makePrisma({ current: null }))).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })
})

describe('reads and delete', () => {
    it('lists upcoming events with booked counts, past too on request', async () => {
        const prisma = makePrisma()
        const out = await new ListOrgEventsHandler(prisma as never, orgRbac() as never).execute(
            new ListOrgEventsFeature({}, ORG, 'u1', false),
        )
        expect(out.data[0]).toMatchObject({ id: 'e1', bookedCount: 23, startAt: '2026-12-20T03:00:00.000Z' })
        expect(prisma.organizationEvent.findMany.mock.calls[0][0].where.OR).toBeDefined()
        await new ListOrgEventsHandler(prisma as never, orgRbac() as never).execute(
            new ListOrgEventsFeature({ includePast: true }, ORG, 'u1', false),
        )
        expect(prisma.organizationEvent.findMany.mock.calls[1][0].where).toEqual({ organizationId: ORG })
    })

    it('gets one event of the org, 404 otherwise', async () => {
        await expect(
            new GetOrgEventHandler(makePrisma() as never, orgRbac() as never).execute(
                new GetOrgEventFeature(ORG, 'e1', 'u1', false),
            ),
        ).resolves.toMatchObject({ id: 'e1', bookedCount: 23 })
        await expect(
            new GetOrgEventHandler(makePrisma({ current: null }) as never, orgRbac() as never).execute(
                new GetOrgEventFeature(ORG, 'e1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('deletes an event of the org, audited', async () => {
        const prisma = makePrisma({ current: { id: 'e1', title: 'Турнир' } })
        const a = audit()
        await new DeleteOrgEventHandler(prisma as never, orgRbac() as never, a as never).execute(
            new DeleteOrgEventFeature(ORG, 'e1', 'u1', false),
        )
        expect(prisma.organizationEvent.delete).toHaveBeenCalledWith({ where: { id: 'e1' } })
        expect(a.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'org.eventDelete' }))
        await expect(
            new DeleteOrgEventHandler(makePrisma({ current: null }) as never, orgRbac() as never, a as never).execute(
                new DeleteOrgEventFeature(ORG, 'e1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('lists registrations of an event of the org', async () => {
        const prisma = makePrisma({ current: { id: 'e1' } })
        await expect(
            new ListOrgEventRegistrationsHandler(prisma as never, orgRbac() as never).execute(
                new ListOrgEventRegistrationsFeature(ORG, 'e1', 'u1', false),
            ),
        ).resolves.toEqual({ data: [], hiddenCount: 0 })
        await expect(
            new ListOrgEventRegistrationsHandler(makePrisma({ current: null }) as never, orgRbac() as never).execute(
                new ListOrgEventRegistrationsFeature(ORG, 'e1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
