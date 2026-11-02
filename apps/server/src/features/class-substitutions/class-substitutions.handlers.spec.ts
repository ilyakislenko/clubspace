import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ownGroupsWhere } from '../../shared/services/rbac.service'
import { isoDayOfWeek } from '../attendance/attendance-utils'
import { ApproveClassSubstitutionHandler } from './approve-class-substitution.handler'
import { CancelClassSubstitutionHandler } from './cancel-class-substitution.handler'
import { CreateClassSubstitutionFeature } from './create-class-substitution.feature'
import { CreateClassSubstitutionHandler } from './create-class-substitution.handler'
import {
    ApproveClassSubstitutionFeature,
    CancelClassSubstitutionFeature,
    DeclineClassSubstitutionFeature,
} from './decide-class-substitution.feature'
import { DeclineClassSubstitutionHandler } from './decline-class-substitution.handler'
import { ListClassSubstitutionsFeature } from './list-class-substitutions.feature'
import { ListClassSubstitutionsHandler } from './list-class-substitutions.handler'

const WS = 'ws-1'
const GROUP = '00000000-0000-4000-8000-0000000000a1'
const SLOT = '00000000-0000-4000-8000-0000000000b1'
const SUB_ID = '00000000-0000-4000-8000-0000000000c1'
// The group's lead coach, another club coach, a stranger.
const LEAD = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const STRANGER = '00000000-0000-4000-8000-000000000003'

// A class a week ahead, so the date window and the weekday both hold.
const ahead = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000)
    return d.toISOString().slice(0, 10)
}
const DATE = ahead(7)
const KEY = `slot:${SLOT}:${DATE}`
const DOW = isoDayOfWeek(new Date(`${DATE}T00:00:00Z`))

const person = (id: string, firstname: string, lastname: string) => ({
    id,
    email: `${firstname}@club.ru`,
    firstname,
    lastname,
})

// A full ClassSubstitutionRow (the serializer and the notifier read it all).
const subRow = (over: Record<string, unknown> = {}) => ({
    id: SUB_ID,
    workspaceId: WS,
    groupId: GROUP,
    slotId: SLOT,
    sessionDate: new Date(`${DATE}T00:00:00Z`),
    occurrenceKey: KEY,
    substituteId: OTHER,
    status: 'PENDING',
    kind: 'OFFER',
    requestedById: OTHER,
    decidedById: null,
    decidedAt: null,
    note: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
    substitute: person(OTHER, 'Олег', 'Петров'),
    slot: { startTime: '19:00', durationMin: 60 },
    workspace: { timezone: 'Europe/Moscow' },
    group: {
        id: GROUP,
        name: 'Вечер',
        directionId: null,
        coachId: LEAD,
        coach: person(LEAD, 'Яна', 'Иванова'),
        gym: null,
        coaches: [{ userId: LEAD }],
    },
    ...over,
})

const makePrisma = () => ({
    groupScheduleSlot: {
        findFirst: jest.fn().mockResolvedValue({
            id: SLOT,
            dayOfWeek: DOW,
            startTime: '19:00',
            effectiveFrom: null,
            effectiveUntil: null,
            group: {
                id: GROUP,
                directionId: null,
                gym: null,
                workspace: { timezone: 'Europe/Moscow', ownerId: 'owner-1' },
                coaches: [{ userId: LEAD }],
                direction: null,
            },
        }),
    },
    scheduleException: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findFirst: jest.fn().mockResolvedValue({ id: OTHER }) },
    classSubstitution: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(subRow()),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
            subRow(data),
        ),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
            subRow(data),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    attendanceSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    groupMember: { findMany: jest.fn().mockResolvedValue([]) },
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
    classBooking: { findMany: jest.fn().mockResolvedValue([]) },
    notificationDispatchLog: { createManyAndReturn: jest.fn().mockResolvedValue([]) },
    workspace: { findUnique: jest.fn().mockResolvedValue({ type: 'GRAPPLING' }) },
})

// `admin` scope = club admin / head coach / owner; otherwise a coach who
// manages `managed` directions.
const makeRbac = (userId: string, o: { admin?: boolean; managed?: string[] } = {}) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: o.admin ? 'admin' : 'coach_own_only',
        userId,
        workspaceId: WS,
        workspaceOwnerId: 'owner-1',
    }),
    canWriteAllGroups: jest.fn().mockReturnValue(!!o.admin),
    managedDirectionIds: jest.fn().mockResolvedValue(o.admin ? null : (o.managed ?? [])),
})

const deps = () => ({
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    notifications: {
        notifyUser: jest.fn().mockResolvedValue(undefined),
        writeMany: jest.fn().mockResolvedValue(0),
    },
    realtime: { invalidate: jest.fn() },
})

const create = (
    prisma: ReturnType<typeof makePrisma>,
    rbac: ReturnType<typeof makeRbac>,
    payload: { slotId?: string; sessionDate?: string; substituteId?: string },
) => {
    const d = deps()
    const handler = new CreateClassSubstitutionHandler(
        prisma as never,
        rbac as never,
        d.audit as never,
        d.notifications as never,
        d.realtime as never,
    )
    return {
        ...d,
        res: handler.execute(
            new CreateClassSubstitutionFeature(
                { slotId: SLOT, sessionDate: DATE, ...payload } as never,
                WS,
                'invoker',
                'coach',
                false,
            ),
        ),
    }
}

describe('CreateClassSubstitutionHandler', () => {
    it('a plain coach offering to take a class files a PENDING OFFER', async () => {
        const prisma = makePrisma()
        const { res, notifications, audit } = create(prisma, makeRbac(OTHER), {})
        const out = await res
        const data = prisma.classSubstitution.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            workspaceId: WS,
            groupId: GROUP,
            slotId: SLOT,
            occurrenceKey: KEY,
            sessionDate: new Date(`${DATE}T00:00:00Z`),
            substituteId: OTHER,
            status: 'PENDING',
            kind: 'OFFER',
            requestedById: OTHER,
            decidedById: null,
            decidedAt: null,
        })
        expect(out).toMatchObject({ status: 'PENDING', kind: 'OFFER', canDecide: false, canCancel: true })
        // Not approved: the session stays with its coach.
        expect(prisma.attendanceSession.updateMany).not.toHaveBeenCalled()
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'group.substituteRequest', targetId: GROUP }),
        )
        // The group's coach is asked to decide.
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({ userId: LEAD, kind: 'substitution.requested' }),
        )
    })

    it('the group coach assigning a substitute approves at once and hands over the session', async () => {
        const prisma = makePrisma()
        const { res, audit } = create(prisma, makeRbac(LEAD), { substituteId: OTHER })
        const out = await res
        const data = prisma.classSubstitution.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            substituteId: OTHER,
            status: 'APPROVED',
            kind: 'ASSIGN',
            requestedById: LEAD,
            decidedById: LEAD,
        })
        expect(data.decidedAt).toBeInstanceOf(Date)
        expect(prisma.attendanceSession.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: WS, occurrenceKey: KEY },
            data: { coachId: OTHER },
        })
        expect(out).toMatchObject({ status: 'APPROVED', kind: 'ASSIGN', canDecide: true })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'group.substituteAssign' }),
        )
    })

    it('a club admin (head coach) assigns too', async () => {
        const prisma = makePrisma()
        await create(prisma, makeRbac(STRANGER, { admin: true }), { substituteId: OTHER }).res
        expect(prisma.classSubstitution.create.mock.calls[0][0].data.status).toBe('APPROVED')
    })

    it('a plain coach may not assign someone else', async () => {
        const prisma = makePrisma()
        prisma.user.findFirst.mockResolvedValue({ id: STRANGER })
        await expect(
            create(prisma, makeRbac(OTHER), { substituteId: STRANGER }).res,
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.classSubstitution.create).not.toHaveBeenCalled()
    })

    it('refuses a substitute who already coaches the group', async () => {
        const prisma = makePrisma()
        await expect(
            create(prisma, makeRbac(STRANGER, { admin: true }), { substituteId: LEAD }).res,
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.classSubstitution.create).not.toHaveBeenCalled()
    })

    it('refuses a substitute who is not a coach of the club', async () => {
        const prisma = makePrisma()
        prisma.user.findFirst.mockResolvedValue(null)
        await expect(
            create(prisma, makeRbac(LEAD), { substituteId: STRANGER }).res,
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('refuses a date the slot has no class on (wrong weekday or cancelled)', async () => {
        const prisma = makePrisma()
        await expect(
            create(prisma, makeRbac(LEAD), { substituteId: OTHER, sessionDate: ahead(8) }).res,
        ).rejects.toBeInstanceOf(BadRequestError)

        prisma.scheduleException.findMany.mockResolvedValue([
            {
                slotId: null,
                fromDate: new Date(`${DATE}T00:00:00Z`),
                untilDate: new Date(`${DATE}T00:00:00Z`),
            },
        ])
        await expect(
            create(prisma, makeRbac(LEAD), { substituteId: OTHER }).res,
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.classSubstitution.create).not.toHaveBeenCalled()
    })

    it('404s a slot of another club', async () => {
        const prisma = makePrisma()
        prisma.groupScheduleSlot.findFirst.mockResolvedValue(null)
        await expect(create(prisma, makeRbac(LEAD), {}).res).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.groupScheduleSlot.findFirst.mock.calls[0][0].where).toEqual({
            id: SLOT,
            group: { workspaceId: WS },
        })
    })

    it('a coach cannot override an existing substitution; the group coach replaces it', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.findUnique.mockResolvedValue({ id: SUB_ID })
        await expect(create(prisma, makeRbac(OTHER), {}).res).rejects.toBeInstanceOf(
            ConflictError,
        )
        expect(prisma.classSubstitution.update).not.toHaveBeenCalled()

        await create(prisma, makeRbac(LEAD), { substituteId: OTHER }).res
        expect(prisma.classSubstitution.update.mock.calls[0][0]).toMatchObject({
            where: { id: SUB_ID },
            data: { status: 'APPROVED', substituteId: OTHER },
        })
        expect(prisma.classSubstitution.create).not.toHaveBeenCalled()
    })

    it('a lost create race reads as a conflict', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.create.mockRejectedValue({ code: 'P2002' })
        await expect(create(prisma, makeRbac(OTHER), {}).res).rejects.toBeInstanceOf(
            ConflictError,
        )
    })
})

const action = <H>(
    Handler: new (...args: never[]) => H,
    prisma: ReturnType<typeof makePrisma>,
    rbac: ReturnType<typeof makeRbac>,
) => {
    const d = deps()
    const handler = new (Handler as unknown as new (...a: unknown[]) => {
        execute: (f: unknown) => Promise<{ substitution: unknown }>
    })(prisma, rbac, d.audit, d.notifications, d.realtime)
    return { ...d, handler }
}

describe('ApproveClassSubstitutionHandler', () => {
    const run = (prisma: ReturnType<typeof makePrisma>, rbac: ReturnType<typeof makeRbac>) => {
        const a = action(ApproveClassSubstitutionHandler, prisma, rbac)
        return {
            ...a,
            res: a.handler.execute(
                new ApproveClassSubstitutionFeature(WS, SUB_ID, 'invoker', 'coach', false),
            ),
        }
    }

    it('refuses whoever does not run the group (the substitute included)', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, makeRbac(OTHER)).res).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.classSubstitution.updateMany).not.toHaveBeenCalled()
    })

    it('404s a substitution of another club', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.findFirst.mockResolvedValue(null)
        await expect(run(prisma, makeRbac(LEAD)).res).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.classSubstitution.findFirst.mock.calls[0][0].where).toEqual({
            id: SUB_ID,
            workspaceId: WS,
        })
    })

    it('conflicts when the request is no longer pending', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(prisma, makeRbac(LEAD)).res).rejects.toBeInstanceOf(ConflictError)
        expect(prisma.attendanceSession.updateMany).not.toHaveBeenCalled()
    })

    it('approves a pending offer and hands the session to the substitute', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.findFirst
            .mockResolvedValueOnce(subRow())
            .mockResolvedValueOnce(
                subRow({ status: 'APPROVED', decidedById: LEAD, decidedAt: new Date() }),
            )
        const { res, audit, notifications } = run(prisma, makeRbac(LEAD))
        const out = await res
        expect(prisma.classSubstitution.updateMany.mock.calls[0][0]).toMatchObject({
            where: { id: SUB_ID, status: 'PENDING' },
            data: { status: 'APPROVED', decidedById: LEAD },
        })
        expect(prisma.attendanceSession.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: WS, occurrenceKey: KEY },
            data: { coachId: OTHER },
        })
        expect(out.substitution).toMatchObject({ status: 'APPROVED', canDecide: true })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'group.substituteApprove' }),
        )
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({ userId: OTHER, topic: 'Замену одобрили' }),
        )
    })

    it('a manager of the group’s direction approves too', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.findFirst.mockResolvedValue(
            subRow({ group: { ...subRow().group, directionId: 'dir-1' } }),
        )
        await run(prisma, makeRbac(STRANGER, { managed: ['dir-1'] })).res
        expect(prisma.classSubstitution.updateMany).toHaveBeenCalled()
    })
})

describe('DeclineClassSubstitutionHandler', () => {
    const run = (prisma: ReturnType<typeof makePrisma>, rbac: ReturnType<typeof makeRbac>) => {
        const a = action(DeclineClassSubstitutionHandler, prisma, rbac)
        return {
            ...a,
            res: a.handler.execute(
                new DeclineClassSubstitutionFeature(WS, SUB_ID, 'invoker', 'coach', false),
            ),
        }
    }

    it('refuses whoever does not run the group', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, makeRbac(OTHER)).res).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.classSubstitution.deleteMany).not.toHaveBeenCalled()
    })

    it('deletes only a pending request and tells the coach who offered', async () => {
        const prisma = makePrisma()
        const { res, notifications } = run(prisma, makeRbac(LEAD))
        expect(await res).toEqual({ substitution: null })
        expect(prisma.classSubstitution.deleteMany).toHaveBeenCalledWith({
            where: { id: SUB_ID, status: 'PENDING' },
        })
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({ userId: OTHER, topic: 'Замену отклонили' }),
        )
    })

    it('conflicts when it was already approved or withdrawn', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.deleteMany.mockResolvedValue({ count: 0 })
        await expect(run(prisma, makeRbac(LEAD)).res).rejects.toBeInstanceOf(ConflictError)
    })
})

describe('CancelClassSubstitutionHandler', () => {
    const run = (prisma: ReturnType<typeof makePrisma>, rbac: ReturnType<typeof makeRbac>) => {
        const a = action(CancelClassSubstitutionHandler, prisma, rbac)
        return {
            ...a,
            res: a.handler.execute(
                new CancelClassSubstitutionFeature(WS, SUB_ID, 'invoker', 'coach', false),
            ),
        }
    }

    it('the substitute withdraws a pending offer; the session is untouched', async () => {
        const prisma = makePrisma()
        expect(await run(prisma, makeRbac(OTHER)).res).toEqual({ substitution: null })
        expect(prisma.classSubstitution.deleteMany).toHaveBeenCalledWith({
            where: { id: SUB_ID, status: 'PENDING' },
        })
        expect(prisma.attendanceSession.updateMany).not.toHaveBeenCalled()
    })

    it('refuses a coach who neither runs the group nor is part of it', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, makeRbac(STRANGER)).res).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.classSubstitution.deleteMany).not.toHaveBeenCalled()
    })

    it('cancelling an approved substitution returns the session to the group coach', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.findFirst.mockResolvedValue(
            subRow({ status: 'APPROVED', kind: 'ASSIGN', requestedById: LEAD }),
        )
        const { res, audit } = run(prisma, makeRbac(LEAD))
        await res
        expect(prisma.classSubstitution.deleteMany).toHaveBeenCalledWith({
            where: { id: SUB_ID, status: 'APPROVED' },
        })
        expect(prisma.attendanceSession.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: WS, occurrenceKey: KEY },
            data: { coachId: LEAD },
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'group.substituteCancel',
                metadata: expect.objectContaining({ status: 'APPROVED' }),
            }),
        )
    })

    it('conflicts when the row changed meanwhile', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.deleteMany.mockResolvedValue({ count: 0 })
        await expect(run(prisma, makeRbac(OTHER)).res).rejects.toBeInstanceOf(ConflictError)
        expect(prisma.attendanceSession.updateMany).not.toHaveBeenCalled()
    })
})

describe('ListClassSubstitutionsHandler', () => {
    const run = (
        prisma: ReturnType<typeof makePrisma>,
        rbac: ReturnType<typeof makeRbac>,
        payload = { from: '2026-11-01', to: '2026-11-30' },
    ) =>
        new ListClassSubstitutionsHandler(prisma as never, rbac as never).execute(
            new ListClassSubstitutionsFeature(payload, WS, 'invoker', 'coach', false),
        )

    it('a coach sees only substitutions they take part in or decide on', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.findMany.mockResolvedValue([subRow()])
        const out = await run(prisma, makeRbac(OTHER))
        expect(prisma.classSubstitution.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: WS,
            sessionDate: {
                gte: new Date('2026-11-01T00:00:00Z'),
                lte: new Date('2026-11-30T00:00:00Z'),
            },
            OR: [
                { substituteId: OTHER },
                { requestedById: OTHER },
                { group: ownGroupsWhere(OTHER) },
            ],
        })
        expect(out.data).toHaveLength(1)
        expect(out.data[0]).toMatchObject({
            id: SUB_ID,
            sessionDate: DATE,
            groupName: 'Вечер',
            canDecide: false,
            canCancel: true,
            regularCoach: { id: LEAD },
        })
    })

    it('a club admin sees the whole club and decides on everything', async () => {
        const prisma = makePrisma()
        prisma.classSubstitution.findMany.mockResolvedValue([subRow()])
        const out = await run(prisma, makeRbac(STRANGER, { admin: true }))
        expect(prisma.classSubstitution.findMany.mock.calls[0][0].where.OR).toBeUndefined()
        expect(out.data[0].canDecide).toBe(true)
    })

    it('refuses a reversed or too long period', async () => {
        const prisma = makePrisma()
        await expect(
            run(prisma, makeRbac(OTHER), { from: '2026-11-30', to: '2026-11-01' }),
        ).rejects.toBeInstanceOf(BadRequestError)
        await expect(
            run(prisma, makeRbac(OTHER), { from: '2026-01-01', to: '2026-12-31' }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.classSubstitution.findMany).not.toHaveBeenCalled()
    })
})
