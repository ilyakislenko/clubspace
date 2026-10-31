import { PushDeliveryProcessor } from './push-delivery.processor'

const build = () => {
    const delivery = {
        deliver: jest.fn().mockResolvedValue({ delivered: 1, retry: 0, tickets: [] }),
        pruneFromReceipts: jest.fn().mockResolvedValue(0),
        findStalePending: jest.fn().mockResolvedValue([]),
    }
    const pushQueue = {
        enqueue: jest.fn().mockResolvedValue(undefined),
        enqueueReceipts: jest.fn().mockResolvedValue(undefined),
    }
    const queue = { upsertJobScheduler: jest.fn().mockResolvedValue({}) }
    const processor = new PushDeliveryProcessor(
        delivery as never,
        pushQueue as never,
        queue as never,
    )
    return { processor, delivery, pushQueue, queue }
}

const job = (name: string, data: unknown) => ({ name, data }) as never

describe('PushDeliveryProcessor', () => {
    it('registers the recovery sweep as a single scheduler', async () => {
        const { processor, queue } = build()
        await processor.onModuleInit()
        expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
            'push-sweep',
            { every: 5 * 60_000 },
            expect.objectContaining({ name: 'sweep' }),
        )
    })

    it('delivers a send job and queues receipt checks for its tickets', async () => {
        const { processor, delivery, pushQueue } = build()
        delivery.deliver.mockResolvedValue({
            delivered: 1,
            retry: 0,
            tickets: [{ id: 't1', token: 'a' }],
        })
        await processor.process(job('send', { ids: ['n1'] }))
        expect(delivery.deliver).toHaveBeenCalledWith(['n1'])
        expect(pushQueue.enqueueReceipts).toHaveBeenCalledWith([
            { id: 't1', token: 'a' },
        ])
    })

    it('fails the job so BullMQ retries when rows were put back to pending', async () => {
        const { processor, delivery } = build()
        delivery.deliver.mockResolvedValue({ delivered: 0, retry: 2, tickets: [] })
        await expect(
            processor.process(job('send', { ids: ['n1', 'n2'] })),
        ).rejects.toThrow('2 push notification(s) failed transiently')
    })

    it('prunes tokens from a receipts job', async () => {
        const { processor, delivery } = build()
        delivery.pruneFromReceipts.mockResolvedValue(1)
        const tickets = [{ id: 't1', token: 'a' }]
        await processor.process(job('receipts', { tickets }))
        expect(delivery.pruneFromReceipts).toHaveBeenCalledWith(tickets)
    })

    it('re-enqueues stale pending rows on a sweep, and nothing when there are none', async () => {
        const { processor, delivery, pushQueue } = build()
        await processor.process(job('sweep', {}))
        expect(pushQueue.enqueue).not.toHaveBeenCalled()

        delivery.findStalePending.mockResolvedValue(['n1', 'n2'])
        await processor.process(job('sweep', {}))
        expect(pushQueue.enqueue).toHaveBeenCalledWith(['n1', 'n2'])
    })

    it('ignores an unknown job name', async () => {
        const { processor, delivery } = build()
        await expect(processor.process(job('legacy', {}))).resolves.toBeUndefined()
        expect(delivery.deliver).not.toHaveBeenCalled()
    })
})
