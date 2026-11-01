const mockBilling = { enabled: true }
jest.mock('../../../environments/environment', () => ({
    environment: {
        get billing() {
            return mockBilling
        },
    },
}))

import { PlatformAutopayService } from './platform-autopay.service'

const NOW = new Date('2026-11-01T12:00:00.000Z')

const build = (ids: string[] = ['w1', 'w2', 'w3']) => {
    const prisma = {
        workspaceBilling: {
            findMany: jest.fn().mockResolvedValue(ids.map((workspaceId) => ({ workspaceId }))),
        },
    }
    const payments = {
        renew: jest.fn().mockResolvedValue({ outcome: 'CHARGED' }),
    }
    const service = new PlatformAutopayService(prisma as never, payments as never)
    return { service, prisma, payments }
}

describe('PlatformAutopayService', () => {
    beforeEach(() => {
        mockBilling.enabled = true
    })

    it('does nothing while billing is off', async () => {
        mockBilling.enabled = false
        const { service, prisma } = build()
        await expect(service.runRenewals(NOW)).resolves.toEqual({})
        expect(prisma.workspaceBilling.findMany).not.toHaveBeenCalled()
    })

    it('selects due or overdue clubs with a due retry and a card or a maybe-free bill', async () => {
        const { service, prisma } = build([])
        await service.runRenewals(NOW)
        expect(prisma.workspaceBilling.findMany).toHaveBeenCalledWith({
            where: {
                autopayEnabled: true,
                AND: [
                    {
                        OR: [
                            {
                                status: 'ACTIVE',
                                currentPeriodEnd: { lte: new Date('2026-11-02T12:00:00.000Z') },
                            },
                            { status: 'PAST_DUE' },
                            // An ended trial: a card bound during it pays the first period.
                            { status: 'TRIAL', trialEndsAt: { lte: NOW } },
                        ],
                    },
                    {
                        OR: [
                            { autopayNextAttemptAt: null },
                            { autopayNextAttemptAt: { lte: NOW } },
                        ],
                    },
                    {
                        OR: [
                            { paymentMethodId: { not: null } },
                            { customMonthlyPrice: 0 },
                            {
                                discountPercent: { gte: 100 },
                                OR: [
                                    { discountUntil: null },
                                    { discountUntil: { gt: NOW } },
                                ],
                            },
                            { freeUntil: { gt: NOW } },
                        ],
                    },
                ],
            },
            select: { workspaceId: true },
        })
    })

    it('renews every candidate as autopay and counts the outcomes', async () => {
        const { service, payments } = build()
        payments.renew
            .mockResolvedValueOnce({ outcome: 'CHARGED' })
            .mockResolvedValueOnce({ outcome: 'FREE' })
            .mockResolvedValueOnce({ outcome: 'CHARGED' })
        await expect(service.runRenewals(NOW)).resolves.toEqual({ CHARGED: 2, FREE: 1 })
        expect(payments.renew).toHaveBeenCalledWith('w1', { initiator: 'AUTOPAY', now: NOW })
        expect(payments.renew).toHaveBeenCalledTimes(3)
    })

    it('keeps going when one club fails', async () => {
        const { service, payments } = build()
        payments.renew
            .mockResolvedValueOnce({ outcome: 'CHARGED' })
            .mockRejectedValueOnce(new Error('db down'))
            .mockResolvedValueOnce({ outcome: 'CHARGED' })
        await expect(service.runRenewals(NOW)).resolves.toEqual({ CHARGED: 2 })
        expect(payments.renew).toHaveBeenLastCalledWith('w3', { initiator: 'AUTOPAY', now: NOW })
    })
})
