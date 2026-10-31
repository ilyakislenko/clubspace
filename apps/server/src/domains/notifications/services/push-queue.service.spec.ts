import { Logger } from '@nestjs/common'

import { PUSH_RECEIPTS_JOB_OPTS, PUSH_SEND_JOB_OPTS } from '../push-queue'
import { PushQueueService } from './push-queue.service'

const build = () => {
    const queue = {
        addBulk: jest.fn().mockResolvedValue([]),
        add: jest.fn().mockResolvedValue({}),
    }
    return { queue, service: new PushQueueService(queue as never) }
}

describe('PushQueueService.enqueue', () => {
    it('splits the ids into send jobs of at most 100', async () => {
        const { queue, service } = build()
        const ids = Array.from({ length: 250 }, (_, i) => `n${i}`)

        await service.enqueue(ids)

        const jobs = queue.addBulk.mock.calls[0][0]
        expect(jobs.map((j: { data: { ids: string[] } }) => j.data.ids.length)).toEqual([
            100, 100, 50,
        ])
        expect(jobs[0]).toMatchObject({ name: 'send', opts: PUSH_SEND_JOB_OPTS })
        expect(jobs[2].data.ids[49]).toBe('n249')
    })

    it('does nothing for no ids', async () => {
        const { queue, service } = build()
        await service.enqueue([])
        expect(queue.addBulk).not.toHaveBeenCalled()
    })

    it('swallows a Redis failure: the rows are committed and the sweep retries', async () => {
        const warn = jest
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined)
        const { queue, service } = build()
        queue.addBulk.mockRejectedValue(new Error('ECONNREFUSED'))

        await expect(service.enqueue(['n1'])).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'))
        warn.mockRestore()
    })
})

describe('PushQueueService.enqueueReceipts', () => {
    it('schedules a delayed receipt check for the accepted tickets', async () => {
        const { queue, service } = build()
        await service.enqueueReceipts([{ id: 't1', token: 'a' }])
        expect(queue.add).toHaveBeenCalledWith(
            'receipts',
            { tickets: [{ id: 't1', token: 'a' }] },
            PUSH_RECEIPTS_JOB_OPTS,
        )
    })

    it('skips an empty ticket list', async () => {
        const { queue, service } = build()
        await service.enqueueReceipts([])
        expect(queue.add).not.toHaveBeenCalled()
    })
})
