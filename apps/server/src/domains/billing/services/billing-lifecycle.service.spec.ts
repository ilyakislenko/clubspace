const billingEnv = { enabled: true, graceDays: 7 }
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
    plan: { priceMonthly: 490_000 },
    ...over,
})

const build = (rows: unknown[], count = 1) => {
    const prisma = {
        workspaceBilling: {
            findMany: jest.fn().mockResolvedValue(rows),
            updateMany: jest.fn().mockResolvedValue({ count }),
        },
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

    it('suspends a club past its grace period', async () => {
        const { service, prisma } = build([
            row({ status: 'PAST_DUE', pastDueSince: daysAgo(8) }),
        ])
        await expect(service.run(now)).resolves.toEqual({
            pastDue: 0,
            suspended: 1,
        })
        expect(prisma.workspaceBilling.updateMany.mock.calls[0][0].data).toEqual({
            status: 'SUSPENDED',
        })
    })

    it('skips rows with nothing to do and rows an operator changed meanwhile', async () => {
        const { service, prisma, audit } = build(
            [
                row({ status: 'PAST_DUE', pastDueSince: daysAgo(1) }),
                row({
                    id: 'b2',
                    currentPeriodEnd: daysAgo(1),
                    plan: { priceMonthly: 0 },
                }),
                row({ id: 'b3', status: 'TRIAL', trialEndsAt: daysAgo(2) }),
            ],
            0,
        )
        await expect(service.run(now)).resolves.toEqual({
            pastDue: 0,
            suspended: 0,
        })
        // Only b3 had a transition; its guarded update matched nothing.
        expect(prisma.workspaceBilling.updateMany).toHaveBeenCalledTimes(1)
        expect(audit.record).not.toHaveBeenCalled()
    })
})
