jest.mock('../../environments/environment', () => ({
    environment: {
        demo: { enabled: false },
        consent: { personalDataVersion: '2026-11-01' },
        billing: { legal: { offerVersion: 'o', dpaVersion: 'd' } },
        encryptionKey: 'demo-secret',
        s3Storage: { s3BucketName: 'clubspace' },
    },
}))
jest.mock('./demo-club.wipe', () => ({
    wipeDemoWorkspace: jest.fn().mockResolvedValue(undefined),
    deleteDemoOnlyUsers: jest.fn().mockResolvedValue(0),
}))
jest.mock('./demo-club.writer', () => ({
    writeDemoClubPlan: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('./demo-organization', () => ({
    ...jest.requireActual('./demo-organization'),
    seedDemoOrganization: jest.fn().mockResolvedValue('seeded'),
}))

import { environment } from '../../environments/environment'
import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { DemoClubService } from './demo-club.service'
import { deleteDemoOnlyUsers, wipeDemoWorkspace } from './demo-club.wipe'
import { writeDemoClubPlan } from './demo-club.writer'
import { DEMO_ORG_ID, seedDemoOrganization } from './demo-organization'

const ON = { enabled: true, workspaceKey: 'academy-demo', code: '730592' }

const build = (holder: { id: string; isDemo: boolean } | null, org: { id: string } | null = { id: 'org-demo' }) => {
    const tx = { workspace: { findUnique: jest.fn().mockResolvedValue(holder) } }
    const prisma = {
        workspace: { findUnique: jest.fn().mockResolvedValue(holder) },
        organization: { findUnique: jest.fn().mockResolvedValue(org) },
        $transaction: jest.fn().mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const freezes = {}
    const analytics = { refresh: jest.fn().mockResolvedValue(undefined) }
    const orgMetrics = { invalidate: jest.fn().mockResolvedValue(undefined) }
    const service = new DemoClubService(
        prisma as never,
        freezes as never,
        audit as never,
        analytics as never,
        orgMetrics as never,
    )
    return { service, prisma, audit, freezes, tx, analytics, orgMetrics }
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
        expect(seedDemoOrganization).not.toHaveBeenCalled()
    })

    it('wipes the demo club and its people, regenerates and audits', async () => {
        const { service, tx, audit, freezes, analytics, orgMetrics } = build({ id: 'w-demo', isDemo: true })
        const now = new Date('2026-11-04T09:30:00.000Z')
        const result = await service.reset({ club: 'academy', actorId: 'admin', now })
        expect(wipeDemoWorkspace).toHaveBeenCalledWith(tx, 'w-demo')
        expect(deleteDemoOnlyUsers).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'academy' }))
        const [, plan, deps] = (writeDemoClubPlan as jest.Mock).mock.calls[0]
        expect(plan.workspace.key).toBe('academy-demo')
        expect(deps).toEqual({ freezes, now })
        expect(result.counts.members).toBe(plan.members.length)
        expect(analytics.refresh).toHaveBeenCalledWith(result.workspaceId, now)
        // The demo federation is put back as scripted, in its own transaction.
        expect(seedDemoOrganization).toHaveBeenCalledWith(tx, { now, personalDataConsentVersion: '2026-11-01' })
        // …and its cached club numbers dropped.
        expect(orgMetrics.invalidate).toHaveBeenCalledWith(DEMO_ORG_ID)
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

    it('resets «Беркут» at its own key as a grappling club', async () => {
        const { service, tx } = build({ id: 'w-berkut', isDemo: true })
        const result = await service.reset({ club: 'berkut', actorId: 'admin', now: new Date('2026-11-04T09:30:00.000Z') })
        expect(tx.workspace.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'berkut-demo' } }))
        expect(wipeDemoWorkspace).toHaveBeenCalledWith(tx, 'w-berkut')
        expect(deleteDemoOnlyUsers).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'berkut' }))
        const [, plan] = (writeDemoClubPlan as jest.Mock).mock.calls[0]
        expect(plan.workspace).toMatchObject({ key: 'berkut-demo', type: 'GRAPPLING', isDemo: true })
        expect(result.club).toBe('berkut')
        expect(seedDemoOrganization).toHaveBeenCalledTimes(1)
    })
})

describe('DemoClubService.ensureSeeded', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        environment.demo = { enabled: false }
    })

    it('leaves existing demo clubs and the demo federation alone', async () => {
        const { service, prisma } = build({ id: 'w-demo', isDemo: true })
        await expect(service.ensureSeeded()).resolves.toEqual({ academy: 'present', ritm: 'present', berkut: 'present' })
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(seedDemoOrganization).not.toHaveBeenCalled()
    })

    it('seeds the demo federation when it is missing', async () => {
        const { service, prisma } = build({ id: 'w-demo', isDemo: true }, null)
        await service.ensureSeeded()
        expect(prisma.organization.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { key: 'tomsk-bjj-federation-demo' } }),
        )
        expect(writeDemoClubPlan).not.toHaveBeenCalled()
        expect(seedDemoOrganization).toHaveBeenCalledTimes(1)
    })

    it('stays away from a real club holding a demo key', async () => {
        const { service, prisma } = build({ id: 'w-real', isDemo: false })
        await expect(service.ensureSeeded()).resolves.toEqual({ academy: 'blocked', ritm: 'blocked', berkut: 'blocked' })
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('generates every club when missing, then the federation, without demo mode', async () => {
        const { service } = build(null)
        await expect(service.ensureSeeded()).resolves.toEqual({ academy: 'created', ritm: 'created', berkut: 'created' })
        expect(writeDemoClubPlan).toHaveBeenCalledTimes(3)
        const keys = (writeDemoClubPlan as jest.Mock).mock.calls.map(([, plan]) => plan.workspace.key)
        expect(keys).toEqual(['academy-demo', 'ritm-demo', 'berkut-demo'])
        expect(seedDemoOrganization).toHaveBeenCalledTimes(1)
    })
})
