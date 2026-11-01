import { PlatformAutopayProcessor } from './platform-autopay.processor'

describe('PlatformAutopayProcessor', () => {
    const build = () => {
        const autopay = {
            runRenewals: jest.fn().mockResolvedValue({ CHARGED: 1 }),
        }
        const queue = {
            name: 'scheduler-billing-autopay',
            setGlobalConcurrency: jest.fn().mockResolvedValue(undefined),
            upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
        }
        const processor = new PlatformAutopayProcessor(autopay as never, queue as never)
        return { processor, autopay, queue }
    }

    it('upserts one hourly scheduler and runs one job at a time across replicas', async () => {
        const { processor, queue } = build()
        await processor.onModuleInit()
        expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(1)
        expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
            'scheduler-billing-autopay',
            { pattern: '20 * * * *', tz: 'UTC' },
            expect.objectContaining({ name: 'scheduler-billing-autopay' }),
        )
    })

    it('runs the renewal pass for each job', async () => {
        const { processor, autopay } = build()
        await processor.process({ id: '7' } as never)
        expect(autopay.runRenewals).toHaveBeenCalledTimes(1)
    })

    it('lets a failed pass fail the job so BullMQ records it', async () => {
        const { processor, autopay } = build()
        autopay.runRenewals.mockRejectedValue(new Error('db down'))
        await expect(processor.process({ id: '8' } as never)).rejects.toThrow('db down')
    })
})
