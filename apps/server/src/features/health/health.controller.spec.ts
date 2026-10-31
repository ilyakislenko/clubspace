// environment.ts reads required env vars at import; stub it, and flip
// `production` per test to check what the public probe reveals.
jest.mock('../../environments/environment', () => ({
    environment: { production: false },
}))

import { environment } from '../../environments/environment'
import { HealthController } from './health.controller'

type ResStub = { status: jest.Mock; statusCode?: number }

const makeRes = (): ResStub => {
    const res: ResStub = {
        status: jest.fn((code: number) => {
            res.statusCode = code
            return res
        }) as unknown as jest.Mock,
    }
    return res
}

type BuildOpts = {
    dbFails?: boolean
    redisPong?: string
    redisFails?: boolean
    // false = the transport reports itself unusable; 'throw' = verify rejects.
    smtp?: true | false | 'throw'
    workers?: number
    waiting?: number
    workersFail?: boolean
    clientListUnsupported?: boolean
}

const build = (opts: BuildOpts = {}) => {
    const prisma = {
        $queryRaw: opts.dbFails
            ? jest.fn().mockRejectedValue(new Error('db down'))
            : jest.fn().mockResolvedValue([{ 1: 1 }]),
    }
    const queue = {
        client: opts.redisFails
            ? Promise.reject(new Error('redis down'))
            : Promise.resolve({
                  ping: jest.fn().mockResolvedValue(opts.redisPong ?? 'PONG'),
              }),
        getWorkers: opts.workersFail
            ? jest.fn().mockRejectedValue(new Error('NOPERM client|list'))
            : jest
                  .fn()
                  .mockResolvedValue(
                      opts.clientListUnsupported
                          ? [{ name: 'GCP does not support client list' }]
                          : Array.from({ length: opts.workers ?? 1 }, () => ({
                                name: 'bull:video-transcode',
                            })),
                  ),
        getWaitingCount: jest.fn().mockResolvedValue(opts.waiting ?? 0),
    }
    const mailer = {
        verifyAllTransporters: jest.fn().mockImplementation(() => {
            if (opts.smtp === 'throw') {
                return Promise.reject(new Error('connect ECONNREFUSED'))
            }
            return Promise.resolve(opts.smtp ?? true)
        }),
    }
    return {
        controller: new HealthController(
            prisma as never,
            queue as never,
            mailer as never,
        ),
        mailer,
    }
}

describe('HealthController', () => {
    it('healthz is a dumb liveness probe — it never consults dependencies', () => {
        const { controller, mailer } = build({ smtp: false })
        expect(controller.healthz()).toEqual({ status: 'ok' })
        expect(mailer.verifyAllTransporters).not.toHaveBeenCalled()
    })

    it('readyz is ok when every dependency answers', async () => {
        const { controller } = build()
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(out).toEqual({
            status: 'ok',
            checks: { db: 'ok', redis: 'ok', smtp: 'ok', videoWorker: 'ok' },
        })
        expect(res.status).not.toHaveBeenCalled()
    })

    // Redis answering PONG says nothing about anyone consuming the queue: with
    // the worker dead, uploads stay on "processing" and no other check notices.
    it('reports a transcode queue with nobody consuming it', async () => {
        const { controller } = build({ workers: 0, waiting: 4 })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(out.checks.videoWorker).toMatch(/no consumers, 4 job\(s\) waiting/)
        expect(out.checks.redis).toBe('ok')
    })

    // A missing transcoder must not take the API out of rotation — that turns
    // "videos are slow" into "the product is down".
    it('stays ready when only the video worker is gone', async () => {
        const { controller } = build({ workers: 0 })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(res.status).not.toHaveBeenCalled()
        expect(out.status).toBe('ok')
        expect(out.checks.videoWorker).toBe('no consumers, queue empty')
    })

    it('degrades to a message when the worker probe itself fails', async () => {
        const { controller } = build({ workersFail: true })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(res.status).not.toHaveBeenCalled()
        expect(out.checks.videoWorker).toMatch(/NOPERM/)
    })

    // Managed Redis that blocks CLIENT LIST does not surface as an error:
    // BullMQ catches it and answers with one placeholder client. Counting that
    // as a consumer would report a healthy pipeline forever, whatever happened
    // to the worker — a silent false negative, the worst kind for a probe.
    it('does not count the CLIENT LIST placeholder as a live consumer', async () => {
        const { controller } = build({ clientListUnsupported: true, waiting: 2 })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(out.checks.videoWorker).toMatch(/consumer count unavailable/)
        expect(out.checks.videoWorker).not.toBe('ok')
    })

    // A wedged worker keeps its Redis connection, so "someone is attached" is
    // not "the queue is moving" — depth is the only cheap way to tell.
    it('flags a backlog piling up behind a connected consumer', async () => {
        const { controller } = build({ workers: 1, waiting: 42 })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(res.status).not.toHaveBeenCalled()
        expect(out.checks.videoWorker).toMatch(/1 consumer\(s\) but 42 job\(s\) waiting/)
    })

    // The reason this check exists: sign-in is an emailed code, so broken SMTP
    // locks everyone out — including the platform owner — while db and redis
    // stay green.
    it('reports 503 when the mail transport is unusable', async () => {
        const { controller } = build({ smtp: false })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(res.statusCode).toBe(503)
        expect(out.status).toBe('not_ready')
        expect(out.checks.smtp).toBe('transport verification failed')
    })

    // verifyAllTransporters resolves `false` instead of throwing, so a
    // try/catch alone reported a dead mail server as healthy.
    it('does not mistake a falsy verify result for success', async () => {
        const { controller } = build({ smtp: false })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(out.checks.smtp).not.toBe('ok')
    })

    it('surfaces the error message when verify rejects', async () => {
        const { controller } = build({ smtp: 'throw' })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(res.statusCode).toBe(503)
        expect(out.checks.smtp).toMatch(/ECONNREFUSED/)
    })

    it('reports a failing database', async () => {
        const { controller } = build({ dbFails: true })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(res.statusCode).toBe(503)
        expect(out.checks.db).toMatch(/db down/)
    })

    it('reports an unexpected redis reply', async () => {
        const { controller } = build({ redisPong: 'NOPE' })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(res.statusCode).toBe(503)
        expect(out.checks.redis).toMatch(/NOPE/)
    })

    // The whole value of the endpoint is naming the broken dependency; the
    // global error filter used to rewrite the body and drop it.
    it('names every failing dependency in one response', async () => {
        const { controller } = build({ dbFails: true, smtp: false })
        const res = makeRes()
        const out = await controller.readyz(res as never)
        expect(out.checks.db).not.toBe('ok')
        expect(out.checks.smtp).not.toBe('ok')
        expect(out.checks.redis).toBe('ok')
    })

    describe('SMTP probe cost', () => {
        afterEach(() => jest.restoreAllMocks())

        // The endpoint is public and unthrottled: every call used to log in
        // to the relay.
        it('reuses a successful SMTP check for a minute', async () => {
            const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
            const { controller, mailer } = build()
            await controller.readyz(makeRes() as never)
            now.mockReturnValue(1_000_000 + 59_000)
            await controller.readyz(makeRes() as never)
            expect(mailer.verifyAllTransporters).toHaveBeenCalledTimes(1)

            now.mockReturnValue(1_000_000 + 61_000)
            await controller.readyz(makeRes() as never)
            expect(mailer.verifyAllTransporters).toHaveBeenCalledTimes(2)
        })

        it('re-checks a failing transport every time', async () => {
            const { controller, mailer } = build({ smtp: false })
            await controller.readyz(makeRes() as never)
            await controller.readyz(makeRes() as never)
            expect(mailer.verifyAllTransporters).toHaveBeenCalledTimes(2)
        })

        it('runs one check for concurrent probes', async () => {
            const { controller, mailer } = build()
            await Promise.all([
                controller.readyz(makeRes() as never),
                controller.readyz(makeRes() as never),
            ])
            expect(mailer.verifyAllTransporters).toHaveBeenCalledTimes(1)
        })
    })

    describe('in production', () => {
        beforeEach(() => {
            environment.production = true
        })
        afterEach(() => {
            environment.production = false
        })

        it('names the failing dependency but not the driver error', async () => {
            const { controller } = build({
                dbFails: true,
                redisPong: 'NOPE',
                smtp: 'throw',
                workersFail: true,
            })
            const res = makeRes()
            const out = await controller.readyz(res as never)
            expect(res.statusCode).toBe(503)
            expect(out.checks).toEqual({
                db: 'fail',
                redis: 'fail',
                smtp: 'fail',
                videoWorker: 'fail',
            })
        })

        it('says fail for an unusable transport', async () => {
            const { controller } = build({ smtp: false })
            const out = await controller.readyz(makeRes() as never)
            expect(out.checks.smtp).toBe('fail')
        })
    })
})
