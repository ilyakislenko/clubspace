const billingEnv = {
    enabled: true,
    trial: { videoStorageGb: 2, videoViewHoursPerMonth: 10, emails: 3, reminderDays: [23, 28] },
}
jest.mock('../../../environments/environment', () => ({
    environment: {
        get billing() {
            return billingEnv
        },
    },
}))

import { TrialLimitReachedError } from '../../../shared/errors/shared.errors'
import { VIDEO_UNAVAILABLE_FOR_MEMBERS } from '../module-entitlement'
import { TrialLimitsService } from './trial-limits.service'

const GB = 1024 ** 3
const NOW = new Date('2026-11-10T12:00:00.000Z')

const build = (o: {
    status?: string
    currentPeriodEnd?: Date | null
    video?: { mode: string; compUntil: Date | null } | null
    stored?: number
    viewed?: number
    taken?: number
} = {}) => {
    const billingRow = { status: o.status ?? 'TRIAL', currentPeriodEnd: o.currentPeriodEnd ?? null }
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                billing: billingRow,
                moduleEntitlements: o.video ? [o.video] : [],
            }),
        },
        workspaceBilling: { updateMany: jest.fn().mockResolvedValue({ count: o.taken ?? 1 }) },
    }
    const billing = {
        enabled: true,
        storageBytes: jest.fn().mockResolvedValue(o.stored ?? 0),
        viewedSeconds: jest.fn().mockResolvedValue(o.viewed ?? 0),
        getBilling: jest.fn().mockResolvedValue(billingRow),
    }
    return { service: new TrialLimitsService(prisma as never, billing as never), prisma, billing }
}

describe('TrialLimitsService', () => {
    it('refuses a trial upload past the storage cap with the CTA', async () => {
        const { service } = build({ stored: 1.9 * GB })
        await expect(service.assertCanUploadVideo('w1', 0.2 * GB, NOW)).rejects.toMatchObject({
            code: 'TRIAL_LIMIT_REACHED',
            metadata: { limit: 'VIDEO_STORAGE' },
        })
        await expect(service.assertCanUploadVideo('w1', 0.1 * GB, NOW)).resolves.toBeUndefined()
    })

    it('lets a paid or comped club upload without counting storage', async () => {
        const paid = build({ status: 'ACTIVE', currentPeriodEnd: new Date('2026-12-01'), stored: 5 * GB })
        await expect(paid.service.assertCanUploadVideo('w1', GB, NOW)).resolves.toBeUndefined()
        expect(paid.billing.storageBytes).not.toHaveBeenCalled()
        const comp = build({ video: { mode: 'COMP', compUntil: new Date('2027-01-01') }, stored: 5 * GB })
        await expect(comp.service.assertCanUploadVideo('w1', GB, NOW)).resolves.toBeUndefined()
        expect(await comp.service.trialStorage('w1', NOW)).toBeNull()
    })

    it('reports what a trial club may still store', async () => {
        const { service } = build({ stored: 1.5 * GB })
        expect(await service.trialStorage('w1', NOW)).toEqual({
            storedBytes: 1.5 * GB,
            remainingBytes: 0.5 * GB,
        })
        expect(service.storageExceededError(1.5 * GB)).toBeInstanceOf(TrialLimitReachedError)
    })

    it('past the monthly viewing hours: staff get the reason, students a neutral message', async () => {
        const { service } = build({ viewed: 10 * 3600 })
        await expect(service.assertCanPlayVideo('w1', true, NOW)).rejects.toMatchObject({
            metadata: { limit: 'VIDEO_VIEWING' },
        })
        await expect(service.assertCanPlayVideo('w1', false, NOW)).rejects.toMatchObject({
            message: VIDEO_UNAVAILABLE_FOR_MEMBERS,
            metadata: {},
        })
        const under = build({ viewed: 3600 })
        await expect(under.service.assertCanPlayVideo('w1', false, NOW)).resolves.toBeUndefined()
    })

    it('takes trial e-mails from the allowance with a conditional increment', async () => {
        const { service, prisma } = build()
        expect(await service.consumeTrialEmail('w1', NOW)).toBe(true)
        expect(prisma.workspaceBilling.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', status: 'TRIAL', trialEmailsSent: { lt: 3 } },
            data: { trialEmailsSent: { increment: 1 } },
        })
        expect(await build({ taken: 0 }).service.consumeTrialEmail('w1', NOW)).toBe(false)
    })

    it('never counts a paying club or a self-hosted install', async () => {
        const paid = build({ status: 'ACTIVE', currentPeriodEnd: new Date('2026-12-01') })
        expect(await paid.service.consumeTrialEmail('w1', NOW)).toBe(true)
        expect(paid.prisma.workspaceBilling.updateMany).not.toHaveBeenCalled()
        const selfHosted = build()
        selfHosted.billing.enabled = false
        expect(await selfHosted.service.consumeTrialEmail('w1', NOW)).toBe(true)
        await expect(selfHosted.service.assertCanPlayVideo('w1', false, NOW)).resolves.toBeUndefined()
    })
})
