import { BillingLifecycleProcessor } from './billing-lifecycle.processor'

describe('BillingLifecycleProcessor', () => {
    const build = () => {
        const lifecycle = {
            run: jest.fn().mockResolvedValue({ pastDue: 1, suspended: 0 }),
        }
        const queue = {
            name: 'scheduler-billing',
            setGlobalConcurrency: jest.fn().mockResolvedValue(undefined),
            upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
        }
        const processor = new BillingLifecycleProcessor(
            lifecycle as never,
            queue as never,
        )
        return { processor, lifecycle, queue }
    }

    it('upserts one daily scheduler and runs one job at a time across replicas', async () => {
        const { processor, queue } = build()
        await processor.onModuleInit()
        expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(1)
        expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
            'scheduler-billing',
            { pattern: '0 3 * * *', tz: 'UTC' },
            expect.objectContaining({ name: 'scheduler-billing' }),
        )
    })

    it('runs the lifecycle pass for each job', async () => {
        const { processor, lifecycle } = build()
        await processor.process({ id: '7' } as never)
        expect(lifecycle.run).toHaveBeenCalledTimes(1)
    })

    it('lets a failed pass fail the job so BullMQ records it', async () => {
        const { processor, lifecycle } = build()
        lifecycle.run.mockRejectedValue(new Error('db down'))
        await expect(processor.process({ id: '8' } as never)).rejects.toThrow(
            'db down',
        )
    })
})
