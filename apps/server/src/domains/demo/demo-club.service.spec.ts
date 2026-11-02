jest.mock('../../environments/environment', () => ({
    environment: {
        demo: { enabled: false },
        consent: { personalDataVersion: '2026-11-01' },
        billing: { legal: { offerVersion: 'o', dpaVersion: 'd' } },
        encryptionKey: 'demo-secret',
    },
}))
jest.mock('./demo-club.wipe', () => ({
    wipeDemoWorkspace: jest.fn().mockResolvedValue(undefined),
    deleteDemoOnlyUsers: jest.fn().mockResolvedValue(0),
}))
jest.mock('./demo-club.writer', () => ({
    writeDemoClubPlan: jest.fn().mockResolvedValue(undefined),
}))

import { environment } from '../../environments/environment'
import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { DemoClubService } from './demo-club.service'
import { deleteDemoOnlyUsers, wipeDemoWorkspace } from './demo-club.wipe'
import { writeDemoClubPlan } from './demo-club.writer'

const ON = { enabled: true, workspaceKey: 'academy-demo', code: '730592' }

const build = (holder: { id: string; isDemo: boolean } | null) => {
    const tx = { workspace: { findUnique: jest.fn().mockResolvedValue(holder) } }
    const prisma = {
        workspace: { findUnique: jest.fn().mockResolvedValue(holder) },
        $transaction: jest.fn().mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const freezes = {}
    const analytics = { refresh: jest.fn().mockResolvedValue(undefined) }
    const service = new DemoClubService(
        prisma as never,
        freezes as never,
        audit as never,
        analytics as never,
    )
    return { service, prisma, audit, freezes, tx, analytics }
}

describe('DemoClubService.reset', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        environment.demo = ON
    })

    it('refuses with demo mode off and touches nothing', async () => {
        environment.demo = { enabled: false }
        const { service, prisma } = build(null)
        await expect(service.reset({ club: 'academy', actorId: 'admin' })).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('never wipes a real club holding the demo key', async () => {
        const { service } = build({ id: 'w-real', isDemo: false })
        await expect(service.reset({ club: 'academy', actorId: 'admin' })).rejects.toBeInstanceOf(BadRequestError)
        expect(wipeDemoWorkspace).not.toHaveBeenCalled()
        expect(writeDemoClubPlan).not.toHaveBeenCalled()
    })

    it('wipes the demo club and its people, regenerates and audits', async () => {
        const { service, tx, audit, freezes, analytics } = build({ id: 'w-demo', isDemo: true })
        const now = new Date('2026-11-04T09:30:00.000Z')
        const result = await service.reset({ club: 'academy', actorId: 'admin', now })
        expect(wipeDemoWorkspace).toHaveBeenCalledWith(tx, 'w-demo')
        expect(deleteDemoOnlyUsers).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'academy' }))
        const [, plan, deps] = (writeDemoClubPlan as jest.Mock).mock.calls[0]
        expect(plan.workspace.key).toBe('academy-demo')
        expect(deps).toEqual({ freezes, now })
        expect(result.counts.members).toBe(plan.members.length)
        expect(analytics.refresh).toHaveBeenCalledWith(result.workspaceId, now)
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'workspace.demoReset',
                workspaceId: null,
                actorId: 'admin',
                targetId: result.workspaceId,
            }),
        )
    })

    it('creates the demo club when there is none yet', async () => {
        const { service } = build(null)
        await service.reset({ club: 'academy', actorId: null })
        expect(wipeDemoWorkspace).not.toHaveBeenCalled()
        expect(writeDemoClubPlan).toHaveBeenCalledTimes(1)
    })

    it('resets the studio at its own key, never the academy', async () => {
        const { service, tx, audit } = build({ id: 'w-ritm', isDemo: true })
        const result = await service.reset({ club: 'ritm', actorId: 'admin', now: new Date('2026-11-04T09:30:00.000Z') })
        expect(tx.workspace.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'ritm-demo' } }))
        expect(tx.workspace.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'academy-demo' } }))
        expect(wipeDemoWorkspace).toHaveBeenCalledTimes(1)
        expect(wipeDemoWorkspace).toHaveBeenCalledWith(tx, 'w-ritm')
        expect(deleteDemoOnlyUsers).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'ritm' }))
        const [, plan] = (writeDemoClubPlan as jest.Mock).mock.calls[0]
        expect(plan.workspace).toMatchObject({ key: 'ritm-demo', type: 'DANCE', isDemo: true })
        expect(result.club).toBe('ritm')
        expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ club: 'ritm' }) }))
    })
})

describe('DemoClubService.ensureSeeded', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        environment.demo = { enabled: false }
    })

    it('leaves existing demo clubs alone', async () => {
        const { service, prisma } = build({ id: 'w-demo', isDemo: true })
        await expect(service.ensureSeeded()).resolves.toEqual({ academy: 'present', ritm: 'present' })
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('stays away from a real club holding a demo key', async () => {
        const { service, prisma } = build({ id: 'w-real', isDemo: false })
        await expect(service.ensureSeeded()).resolves.toEqual({ academy: 'blocked', ritm: 'blocked' })
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('generates both clubs when missing, without demo mode', async () => {
        const { service } = build(null)
        await expect(service.ensureSeeded()).resolves.toEqual({ academy: 'created', ritm: 'created' })
        expect(writeDemoClubPlan).toHaveBeenCalledTimes(2)
        const keys = (writeDemoClubPlan as jest.Mock).mock.calls.map(([, plan]) => plan.workspace.key)
        expect(keys).toEqual(['academy-demo', 'ritm-demo'])
    })
})
