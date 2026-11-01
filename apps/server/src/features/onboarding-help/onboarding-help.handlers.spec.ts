jest.mock('../../environments/environment', () => ({
    environment: { billing: { pricing: { setupFee: 4990 } } },
}))

import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { GetWorkspaceOnboardingHelpHandler } from './get-workspace-onboarding-help.handler'
import { ListPlatformOnboardingRequestsHandler } from './list-platform-onboarding-requests.handler'
import {
    GetWorkspaceOnboardingHelpFeature,
    ListPlatformOnboardingRequestsFeature,
    RequestWorkspaceOnboardingHelpFeature,
    UpdatePlatformOnboardingRequestFeature,
} from './onboarding-help.feature'
import { RequestWorkspaceOnboardingHelpHandler } from './request-workspace-onboarding-help.handler'
import { UpdatePlatformOnboardingRequestHandler } from './update-platform-onboarding-request.handler'

const CREATED = new Date('2026-11-10T12:00:00.000Z')
const request = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    workspaceId: 'w1',
    requestedById: 'u1',
    requesterName: 'Анна Петрова',
    requesterEmail: 'anna@example.com',
    phone: '+79990001122',
    message: 'Помогите',
    status: 'OPEN',
    resolution: null,
    resolvedById: null,
    resolvedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    workspace: { name: 'Клуб', billing: { setupFeeWaived: false, setupFeePaidAt: null } },
    ...over,
})

const deps = (o: { denied?: boolean; open?: boolean; latest?: unknown } = {}) => {
    const prisma = {
        user: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ email: 'anna@example.com', firstname: 'Анна', lastname: 'Петрова' }),
        },
        onboardingHelpRequest: {
            findFirst: jest
                .fn()
                .mockResolvedValueOnce(o.open ? { id: 'r1' } : null)
                .mockResolvedValue(o.latest ?? request()),
            create: jest.fn().mockResolvedValue({ id: 'r1' }),
            update: jest.fn().mockImplementation(async ({ data }) => request(data)),
            findUnique: jest.fn().mockResolvedValue({ id: 'r1', workspaceId: 'w1', status: 'OPEN' }),
            findMany: jest.fn().mockResolvedValue([request()]),
        },
    }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ kind: o.denied ? 'coach' : 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(!o.denied),
    }
    const billing = {
        pricing: { setupFee: 4990 },
        getBilling: jest.fn().mockResolvedValue({ setupFeeWaived: true, setupFeePaidAt: null }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    return { prisma, rbac, billing, audit }
}

describe('onboarding help', () => {
    it('the club files a request for the console; the fee state comes along', async () => {
        const d = deps()
        const handler = new RequestWorkspaceOnboardingHelpHandler(
            d.prisma as never,
            d.rbac as never,
            d.billing as never,
            d.audit as never,
        )
        const out = await handler.execute(
            new RequestWorkspaceOnboardingHelpFeature({ phone: '+79990001122' }, 'w1', 'u1', 'admin', false),
        )
        expect(d.prisma.onboardingHelpRequest.create.mock.calls[0][0].data).toMatchObject({
            workspaceId: 'w1',
            requestedById: 'u1',
            requesterName: 'Анна Петрова',
            phone: '+79990001122',
            message: null,
        })
        expect(out.setupFee).toEqual({ amount: 4990, state: 'WAIVED' })
        expect(out.request?.status).toBe('OPEN')
        expect(d.audit.record.mock.calls[0][0].action).toBe('workspace.onboardingHelpRequest')
    })

    it('updates the open request instead of filing a second one', async () => {
        const d = deps({ open: true })
        const handler = new RequestWorkspaceOnboardingHelpHandler(
            d.prisma as never,
            d.rbac as never,
            d.billing as never,
            d.audit as never,
        )
        await handler.execute(new RequestWorkspaceOnboardingHelpFeature({ message: 'Ещё' }, 'w1', 'u1', 'admin', false))
        expect(d.prisma.onboardingHelpRequest.create).not.toHaveBeenCalled()
        expect(d.prisma.onboardingHelpRequest.update.mock.calls[0][0]).toMatchObject({
            where: { id: 'r1' },
            data: { phone: null, message: 'Ещё' },
        })
    })

    it('only the club admin asks or reads', async () => {
        const d = deps({ denied: true })
        const request = new RequestWorkspaceOnboardingHelpHandler(
            d.prisma as never,
            d.rbac as never,
            d.billing as never,
            d.audit as never,
        )
        await expect(
            request.execute(new RequestWorkspaceOnboardingHelpFeature({}, 'w1', 'u2', 'coach', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        const get = new GetWorkspaceOnboardingHelpHandler(d.prisma as never, d.rbac as never, d.billing as never)
        await expect(get.execute(new GetWorkspaceOnboardingHelpFeature('w1', 'u2', 'coach', false))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(d.prisma.onboardingHelpRequest.create).not.toHaveBeenCalled()
    })

    it('the console lists and closes requests; nobody else can', async () => {
        const d = deps()
        const list = new ListPlatformOnboardingRequestsHandler(d.prisma as never)
        const out = await list.execute(new ListPlatformOnboardingRequestsFeature({ status: 'OPEN' }, 'p1', true))
        expect(d.prisma.onboardingHelpRequest.findMany.mock.calls[0][0].where).toEqual({ status: 'OPEN' })
        expect(out.data[0]).toMatchObject({ workspaceName: 'Клуб', setupFee: { amount: 4990, state: 'DUE' } })
        await expect(list.execute(new ListPlatformOnboardingRequestsFeature({}, 'u1', false))).rejects.toBeInstanceOf(
            ForbiddenError,
        )

        const update = new UpdatePlatformOnboardingRequestHandler(d.prisma as never, d.audit as never)
        const done = await update.execute(
            new UpdatePlatformOnboardingRequestFeature('r1', { status: 'DONE', resolution: 'Готово' }, 'p1', true),
        )
        expect(d.prisma.onboardingHelpRequest.update.mock.calls[0][0].data).toMatchObject({
            status: 'DONE',
            resolution: 'Готово',
            resolvedById: 'p1',
        })
        expect(done.status).toBe('DONE')
        await expect(
            update.execute(new UpdatePlatformOnboardingRequestFeature('r1', { status: 'DONE' }, 'u1', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        d.prisma.onboardingHelpRequest.findUnique.mockResolvedValue(null)
        await expect(
            update.execute(new UpdatePlatformOnboardingRequestFeature('r9', { status: 'DONE' }, 'p1', true)),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
