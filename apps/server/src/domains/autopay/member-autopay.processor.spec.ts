jest.mock('../../environments/environment', () => ({
    environment: { memberAutopay: { enabled: true } },
}))

import { environment } from '../../environments/environment'
import { MemberAutopayProcessor } from './member-autopay.processor'

const env = environment as unknown as { memberAutopay: { enabled: boolean } }

describe('MemberAutopayProcessor', () => {
    const build = () => {
        const autopay = {
            runCharges: jest.fn().mockResolvedValue({ CHARGED: 1 }),
            runReminders: jest.fn().mockResolvedValue(2),
        }
        const queue = {
            name: 'scheduler-member-autopay',
            setGlobalConcurrency: jest.fn().mockResolvedValue(undefined),
            upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
        }
        const processor = new MemberAutopayProcessor(autopay as never, queue as never)
        return { processor, autopay, queue }
    }
    afterEach(() => {
        env.memberAutopay.enabled = true
    })

    it('upserts one hourly scheduler at :40 and runs one job at a time across replicas', async () => {
        const { processor, queue } = build()
        await processor.onModuleInit()
        expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(1)
        expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
            'scheduler-member-autopay',
            { pattern: '40 * * * *', tz: 'UTC' },
            expect.objectContaining({ name: 'scheduler-member-autopay' }),
        )
    })

    it('runs the charges, then the reminders', async () => {
        const { processor, autopay } = build()
        await processor.process({ id: '1' } as never)
        expect(autopay.runCharges).toHaveBeenCalledTimes(1)
        expect(autopay.runReminders).toHaveBeenCalledTimes(1)
    })

    it('does nothing while MEMBER_AUTOPAY_ENABLED is off', async () => {
        env.memberAutopay.enabled = false
        const { processor, autopay } = build()
        await processor.process({ id: '2' } as never)
        expect(autopay.runCharges).not.toHaveBeenCalled()
        expect(autopay.runReminders).not.toHaveBeenCalled()
    })

    it('lets a failed pass fail the job so BullMQ records it', async () => {
        const { processor, autopay } = build()
        autopay.runCharges.mockRejectedValue(new Error('db down'))
        await expect(processor.process({ id: '3' } as never)).rejects.toThrow('db down')
    })
})
