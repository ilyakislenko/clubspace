import { Logger } from '@nestjs/common'

import {
    DailyClubProcessor,
    DigestProcessor,
    PaymentsProcessor,
    PurgeProcessor,
    RemindersProcessor,
    SCHEDULER_QUEUES,
} from './scheduler.processors'

const queue = (name: string) => ({
    name,
    setGlobalConcurrency: jest.fn().mockResolvedValue(1),
    upsertJobScheduler: jest.fn().mockResolvedValue({}),
})

const job = { id: '1' } as never

describe('scheduler processors', () => {
    let log: jest.SpyInstance
    let debug: jest.SpyInstance
    beforeEach(() => {
        log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
        debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    })
    afterEach(() => jest.restoreAllMocks())

    it('registers one scheduler per job and caps each queue at one active run', async () => {
        const q = queue(SCHEDULER_QUEUES.reminders)
        const p = new RemindersProcessor({ run: jest.fn() } as never, q as never)

        await p.onModuleInit()

        expect(q.setGlobalConcurrency).toHaveBeenCalledWith(1)
        expect(q.upsertJobScheduler).toHaveBeenCalledWith(
            'scheduler-reminders',
            { every: 60_000 },
            expect.objectContaining({ name: 'scheduler-reminders' }),
        )
    })

    it('uses a separate queue name and schedule for every job', async () => {
        const qs = Object.values(SCHEDULER_QUEUES).map(queue)
        await new DailyClubProcessor({} as never, qs[1] as never).onModuleInit()
        await new PaymentsProcessor({} as never, {} as never, qs[2] as never).onModuleInit()
        await new DigestProcessor({} as never, qs[3] as never).onModuleInit()
        await new PurgeProcessor({} as never, qs[4] as never).onModuleInit()

        expect(new Set(Object.values(SCHEDULER_QUEUES)).size).toBe(5)
        expect(qs[1].upsertJobScheduler.mock.calls[0][1]).toEqual({ every: 30 * 60_000 })
        expect(qs[4].upsertJobScheduler.mock.calls[0][1]).toEqual({
            pattern: '30 3 * * *',
            tz: 'UTC',
        })
    })

    it('runs the reminders and logs a summary only when something went out', async () => {
        const reminders = {
            run: jest.fn().mockResolvedValue({
                sessionsNotified: 0,
                eventsNotified: 0,
                cancellationsNotified: 0,
                scheduledAnnouncementsPublished: 0,
            }),
        }
        const p = new RemindersProcessor(reminders as never, queue('q') as never)
        await p.process(job)
        expect(log).not.toHaveBeenCalled()
        expect(debug).toHaveBeenCalled()

        reminders.run.mockResolvedValue({
            sessionsNotified: 2,
            eventsNotified: 1,
            cancellationsNotified: 0,
            scheduledAnnouncementsPublished: 0,
        })
        await p.process(job)
        expect(log).toHaveBeenCalledWith(expect.stringContaining('2 classes, 1 events'))
    })

    it('propagates a failed run so BullMQ records it', async () => {
        const p = new RemindersProcessor(
            { run: jest.fn().mockRejectedValue(new Error('db down')) } as never,
            queue('q') as never,
        )
        await expect(p.process(job)).rejects.toThrow('db down')
    })

    it('runs the daily club pass and reports failed clubs', async () => {
        const daily = {
            run: jest.fn().mockResolvedValue({
                clubs: 3,
                failed: 1,
                inactivityNotified: 4,
                accessExpiryNotified: 2,
            }),
        }
        await new DailyClubProcessor(daily as never, queue('q') as never).process(job)
        expect(daily.run).toHaveBeenCalledWith(expect.any(Date))
        expect(Logger.prototype.error).toHaveBeenCalledWith('1 club(s) failed their daily pass')
        expect(log).toHaveBeenCalledWith(expect.stringContaining('3 clubs, 4 inactivity, 2 access expiry'))
    })

    it('runs both abonement passes in the payments job', async () => {
        const payments = { dispatchDue: jest.fn().mockResolvedValue(1) }
        const firstVisit = { run: jest.fn().mockResolvedValue({ autoStarted: 0, reminded: 2 }) }
        await new PaymentsProcessor(
            payments as never,
            firstVisit as never,
            queue('q') as never,
        ).process(job)
        expect(payments.dispatchDue).toHaveBeenCalled()
        expect(firstVisit.run).toHaveBeenCalled()
        expect(log).toHaveBeenCalledWith(expect.stringContaining('1 payment reminders'))
    })

    it('runs the digest and the purge', async () => {
        const digest = { run: jest.fn().mockResolvedValue({ workspaces: 0, sent: 0 }) }
        await new DigestProcessor(digest as never, queue('q') as never).process(job)
        expect(digest.run).toHaveBeenCalled()

        const purge = {
            run: jest.fn().mockResolvedValue({ notifications: 5, dispatchLog: 1, refreshTokens: 0 }),
        }
        await new PurgeProcessor(purge as never, queue('q') as never).process(job)
        expect(log).toHaveBeenCalledWith(expect.stringContaining('5 notifications'))
    })
})
