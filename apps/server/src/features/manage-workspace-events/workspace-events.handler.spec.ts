jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import { ForbiddenError } from '../../shared/errors/shared.errors'
import { CreateWorkspaceEventFeature } from './create-workspace-event.feature'
import { CreateWorkspaceEventHandler } from './create-workspace-event.handler'
import { DeleteWorkspaceEventFeature } from './delete-workspace-event.feature'
import { DeleteWorkspaceEventHandler } from './delete-workspace-event.handler'
import { UpdateWorkspaceEventFeature } from './update-workspace-event.feature'
import { UpdateWorkspaceEventHandler } from './update-workspace-event.handler'

const BJJ = '11111111-1111-4111-8111-111111111111'
const MMA = '22222222-2222-4222-8222-222222222222'

// managed: null = admin, [] = plain coach, [..] = direction manager.
const rbac = (managed: string[] | null) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: managed === null ? 'admin' : 'coach_own_only',
    }),
    managedDirectionIds: jest.fn().mockResolvedValue(managed),
    assertCanManageDirection: jest.fn(
        async (_ctx: unknown, ...ids: Array<string | null | undefined>) => {
            if (managed === null) return
            const named = ids.filter((d) => d !== undefined)
            if (
                named.length === 0 ||
                named.some((d) => d === null || !managed.includes(d))
            ) {
                throw new ForbiddenError({
                    message: 'Нужны права администратора клуба',
                })
            }
        },
    ),
})

const eventRow = (directionId: string | null) => ({
    id: 'e1',
    workspaceId: 'w1',
    title: 'Семинар',
    description: null,
    link: null,
    startAt: new Date('2026-11-10T10:00:00Z'),
    endAt: new Date('2026-11-10T12:00:00Z'),
    timezone: 'Europe/Moscow',
    gymId: null,
    gym: null,
    directionId,
    direction: null,
    coachId: 'u1',
    coach: { id: 'u1', email: 'c@x', firstname: 'C', lastname: null },
    createdById: 'u1',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
})

const prismaFor = (current: string | null) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
    },
    direction: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
    workspaceEvent: {
        create: jest.fn().mockResolvedValue(eventRow(current)),
        findFirst: jest.fn().mockResolvedValue(eventRow(current)),
        update: jest.fn().mockResolvedValue(eventRow(current)),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
})
const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) })
const rt = () => ({ emitListDelta: jest.fn(), invalidate: jest.fn() })

const create = (prisma: unknown, r: unknown, directionId?: string) =>
    new CreateWorkspaceEventHandler(
        prisma as never,
        audit() as never,
        rt() as never,
        r as never,
    ).execute(
        new CreateWorkspaceEventFeature(
            {
                title: 'Семинар',
                startAt: '2026-11-10T10:00',
                endAt: '2026-11-10T12:00',
                directionId,
            } as never,
            'w1',
            'u1',
            'coach',
            false,
        ),
    )
const update = (prisma: unknown, r: unknown, payload: Record<string, unknown>) =>
    new UpdateWorkspaceEventHandler(
        prisma as never,
        audit() as never,
        rt() as never,
        r as never,
    ).execute(
        new UpdateWorkspaceEventFeature(
            payload as never,
            'w1',
            'e1',
            'u1',
            'coach',
            false,
        ),
    )
const remove = (prisma: unknown, r: unknown) =>
    new DeleteWorkspaceEventHandler(
        prisma as never,
        audit() as never,
        rt() as never,
        r as never,
    ).execute(new DeleteWorkspaceEventFeature('w1', 'e1', 'u1', 'coach', false))

describe('workspace events: plain coach (unchanged)', () => {
    it('creates, edits and deletes any event without a direction check', async () => {
        const prisma = prismaFor(MMA)
        const r = rbac([])
        await create(prisma, r)
        await update(prisma, r, { directionId: null })
        await remove(prisma, r)
        expect(r.assertCanManageDirection).not.toHaveBeenCalled()
        expect(prisma.workspaceEvent.create).toHaveBeenCalled()
        expect(prisma.workspaceEvent.update).toHaveBeenCalled()
        expect(prisma.workspaceEvent.deleteMany).toHaveBeenCalled()
    })

    it('admin is not checked either', async () => {
        const prisma = prismaFor(null)
        const r = rbac(null)
        await create(prisma, r)
        await remove(prisma, r)
        expect(r.assertCanManageDirection).not.toHaveBeenCalled()
    })
})

describe('workspace events: direction manager', () => {
    it('creates in a managed direction; refuses another or club-wide', async () => {
        const prisma = prismaFor(BJJ)
        const r = rbac([BJJ])
        await create(prisma, r, BJJ)
        await expect(create(prisma, r, MMA)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        await expect(create(prisma, r)).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenLastCalledWith(
            expect.anything(),
            null,
        )
        expect(prisma.workspaceEvent.create).toHaveBeenCalledTimes(1)
    })

    it('edits own-direction events; refuses a move to another direction', async () => {
        const prisma = prismaFor(BJJ)
        const r = rbac([BJJ])
        await update(prisma, r, { title: 'Новый' })
        await expect(
            update(prisma, r, { directionId: MMA }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenLastCalledWith(
            expect.anything(),
            BJJ,
            MMA,
        )
        expect(prisma.workspaceEvent.update).toHaveBeenCalledTimes(1)
    })

    it('refuses editing a club-wide event', async () => {
        const prisma = prismaFor(null)
        await expect(
            update(prisma, rbac([BJJ]), { title: 'x' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceEvent.update).not.toHaveBeenCalled()
    })

    it('deletes own; refuses another direction event', async () => {
        const own = prismaFor(BJJ)
        await remove(own, rbac([BJJ]))
        expect(own.workspaceEvent.deleteMany).toHaveBeenCalled()
        const other = prismaFor(MMA)
        await expect(remove(other, rbac([BJJ]))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(other.workspaceEvent.deleteMany).not.toHaveBeenCalled()
    })
})
