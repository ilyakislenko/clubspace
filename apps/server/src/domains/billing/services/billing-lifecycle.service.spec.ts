const billingEnv = { enabled: true, graceDays: 7, archiveAfterDays: 30 }
jest.mock('../../../environments/environment', () => ({
    // A getter: jest hoists this factory above the const it reads.
    environment: {
        get billing() {
            return billingEnv
        },
    },
}))

import { BillingLifecycleService } from './billing-lifecycle.service'

const now = new Date('2026-11-10T03:00:00.000Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)

const row = (over: Record<string, unknown>) => ({
    id: 'b1',
    workspaceId: 'w1',
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: null,
    pastDueSince: null,
    freeUntil: null,
    ...over,
})

// `rows` answer the lifecycle query, `archivable` the archive one.
const build = (rows: unknown[], count = 1, archivable: unknown[] = []) => {
    const prisma = {
        workspaceBilling: {
            findMany: jest
                .fn()
                .mockResolvedValueOnce(rows)
                .mockResolvedValueOnce(archivable),
            updateMany: jest.fn().mockResolvedValue({ count }),
        },
        workspace: { update: jest.fn().mockResolvedValue({}) },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    return {
        service: new BillingLifecycleService(prisma as never, audit as never),
        prisma,
        audit,
    }
}

afterEach(() => {
    billingEnv.enabled = true
})

describe('BillingLifecycleService.run', () => {
    it('does nothing when billing is disabled', async () => {
        billingEnv.enabled = false
        const { service, prisma } = build([])
        await expect(service.run(now)).resolves.toEqual({
            pastDue: 0,
            suspended: 0,
            archived: 0,
        })
        expect(prisma.workspaceBilling.findMany).not.toHaveBeenCalled()
    })

    it('moves an ended trial to PAST_DUE, guarded on the status it read, and audits it', async () => {
        const trialEndsAt = daysAgo(1)
        const { service, prisma, audit } = build([
            row({ status: 'TRIAL', trialEndsAt }),
        ])
        await expect(service.run(now)).resolves.toEqual({
            pastDue: 1,
            suspended: 0,
            archived: 0,
        })
        expect(prisma.workspaceBilling.updateMany).toHaveBeenCalledWith({
            where: { id: 'b1', status: 'TRIAL' },
            data: { status: 'PAST_DUE', pastDueSince: trialEndsAt },
        })
        expect(audit.record).toHaveBeenCalledWith({
            action: 'workspace.billingExpire',
            targetType: 'workspace',
            targetId: 'w1',
            workspaceId: 'w1',
            actorId: null,
            metadata: { from: 'TRIAL', to: 'PAST_DUE' },
        })
    })

    it('suspends a club past its grace period and starts the archive countdown', async () => {
        const { service, prisma } = build([
            row({ status: 'PAST_DUE', pastDueSince: daysAgo(8) }),
        ])
        await expect(service.run(now)).resolves.toEqual({
            pastDue: 0,
            suspended: 1,
            archived: 0,
        })
        expect(prisma.workspaceBilling.updateMany.mock.calls[0][0].data).toEqual({
            status: 'SUSPENDED',
            suspendedAt: now,
            archivedAt: null,
        })
    })

    it('keeps a club with a running free period ACTIVE through it', async () => {
        const freeUntil = new Date(now.getTime() + 20 * 86_400_000)
        const { service, prisma, audit } = build([
            row({ currentPeriodEnd: daysAgo(1), freeUntil }),
        ])
        await expect(service.run(now)).resolves.toEqual({
            pastDue: 0,
            suspended: 0,
            archived: 0,
        })
        expect(prisma.workspaceBilling.updateMany).toHaveBeenCalledWith({
            where: { id: 'b1', status: 'ACTIVE' },
            data: { status: 'ACTIVE', currentPeriodEnd: freeUntil },
        })
        expect(audit.record.mock.calls[0][0].metadata).toEqual({ from: 'ACTIVE', to: 'ACTIVE' })
    })

    it('skips rows with nothing to do and rows an operator changed meanwhile', async () => {
        const { service, prisma, audit } = build(
            [
                row({ status: 'PAST_DUE', pastDueSince: daysAgo(1) }),
                // ACTIVE without a period end never expires.
                row({ id: 'b2', currentPeriodEnd: null }),
                row({ id: 'b3', status: 'TRIAL', trialEndsAt: daysAgo(2) }),
            ],
            0,
        )
        await expect(service.run(now)).resolves.toEqual({
            pastDue: 0,
            suspended: 0,
            archived: 0,
        })
        // Only b3 had a transition; its guarded update matched nothing.
        expect(prisma.workspaceBilling.updateMany).toHaveBeenCalledTimes(1)
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('archives a club suspended for PLATFORM_ARCHIVE_AFTER_DAYS: hidden, nothing deleted', async () => {
        const { service, prisma, audit } = build([], 1, [{ id: 'b9', workspaceId: 'w9' }])
        await expect(service.run(now)).resolves.toEqual({
            pastDue: 0,
            suspended: 0,
            archived: 1,
        })
        const query = prisma.workspaceBilling.findMany.mock.calls[1][0]
        expect(query.where).toEqual({
            status: 'SUSPENDED',
            archivedAt: null,
            OR: [
                { suspendedAt: { lte: daysAgo(30) } },
                { suspendedAt: null, updatedAt: { lte: daysAgo(30) } },
            ],
        })
        expect(prisma.workspaceBilling.updateMany).toHaveBeenCalledWith({
            where: { id: 'b9', status: 'SUSPENDED', archivedAt: null },
            data: { archivedAt: now },
        })
        expect(prisma.workspace.update).toHaveBeenCalledWith({
            where: { id: 'w9' },
            data: { isListed: false },
        })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.billingArchive',
            workspaceId: 'w9',
        })
    })

    it('leaves a club the operator resumed meanwhile unarchived', async () => {
        const { service, prisma, audit } = build([], 0, [{ id: 'b9', workspaceId: 'w9' }])
        await expect(service.run(now)).resolves.toMatchObject({ archived: 0 })
        expect(prisma.workspace.update).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })
})
