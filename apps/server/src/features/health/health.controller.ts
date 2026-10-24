import { MailerService } from '@nestjs-modules/mailer'
import { InjectQueue } from '@nestjs/bullmq'
import {
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Res,
} from '@nestjs/common'
import type { Response } from 'express'
import { SkipThrottle } from '@nestjs/throttler'
import type { Queue } from 'bullmq'

import { PrismaService } from '../../infrastructure/prisma'
import { withTimeout } from '../../shared/utils/with-timeout'

// A dead SMTP host can leave a TCP connect hanging far longer than a probe
// should wait, so the mail check is bounded. Slower than this is "broken" for
// readiness purposes even if it would eventually answer.
const SMTP_VERIFY_TIMEOUT_MS = 5000

// BullMQ pins maxRetriesPerRequest: null on its connections, so commands to a
// half-dead Redis queue up instead of rejecting. Unbounded, that hangs the
// probe until the orchestrator's own timeout removes the pod — the very
// outcome the worker check is written not to cause.
const QUEUE_PROBE_TIMEOUT_MS = 2000

// A consumer that is connected but wedged still answers CLIENT LIST, so
// "someone is attached" is not "the queue is moving". Depth past this is the
// only cheap signal that separates the two. Heuristic, and informational only.
const QUEUE_BACKLOG_HINT = 10

// BullMQ swallows "CLIENT LIST unsupported" (some managed Redis) and answers
// with one placeholder client, which would otherwise count as a live worker.
const CLIENT_LIST_UNSUPPORTED = /does not support client list/i

@Controller()
@SkipThrottle()
export class HealthController {
    constructor(
        private readonly prisma: PrismaService,
        @InjectQueue('video-transcode') private readonly queue: Queue,
        private readonly mailer: MailerService,
    ) {}

    @Get('healthz')
    @HttpCode(HttpStatus.OK)
    healthz() {
        return { status: 'ok' }
    }

    @Get('readyz')
    async readyz(@Res({ passthrough: true }) res: Response) {
        const checks: Record<string, 'ok' | string> = {
            db: 'ok',
            redis: 'ok',
            smtp: 'ok',
            videoWorker: 'ok',
        }
        let allOk = true

        try {
            await this.prisma.$queryRaw`SELECT 1`
        } catch (error) {
            allOk = false
            checks.db = error instanceof Error ? error.message : 'fail'
        }

        try {
            const client = await this.queue.client
            const pong = await client.ping()
            if (pong !== 'PONG') {
                allOk = false
                checks.redis = `unexpected response: ${pong}`
            }
        } catch (error) {
            allOk = false
            checks.redis = error instanceof Error ? error.message : 'fail'
        }

        // Mail is load-bearing, not a nicety: sign-in is a code emailed to the
        // user, so a broken SMTP config locks EVERYONE out — including the
        // platform owner — while every other check stays green. It used to
        // surface only as a log line after the first person failed to log in,
        // because the OTP endpoint answers 200 and the send happens later on
        // an event listener.
        try {
            // verifyAllTransporters swallows the underlying error and returns
            // a boolean — checking only for a throw reports a dead mail server
            // as healthy, which is worse than not checking at all.
            const smtpOk = await withTimeout(
                this.mailer.verifyAllTransporters(),
                SMTP_VERIFY_TIMEOUT_MS,
            )
            if (!smtpOk) {
                allOk = false
                checks.smtp = 'transport verification failed'
            }
        } catch (error) {
            allOk = false
            checks.smtp = error instanceof Error ? error.message : 'fail'
        }

        // Reachable Redis is not a working pipeline. If the video-worker dies,
        // every check above stays green while uploads pile up and members sit
        // on "processing" forever — the failure has no symptom until someone
        // complains. Reported, deliberately, WITHOUT touching allOk: the API
        // serves fine without a transcoder, and pulling it out of the load
        // balancer would turn "videos are slow" into "the product is down".
        try {
            const [workers, waiting] = await withTimeout(
                Promise.all([
                    this.queue.getWorkers(),
                    this.queue.getWaitingCount(),
                ]),
                QUEUE_PROBE_TIMEOUT_MS,
            )
            const consumers = workers.filter(
                (worker) => !CLIENT_LIST_UNSUPPORTED.test(worker.name ?? ''),
            ).length

            if (consumers === 0 && workers.length > 0) {
                checks.videoWorker = `consumer count unavailable, ${waiting} job(s) waiting`
            } else if (consumers === 0) {
                checks.videoWorker =
                    waiting > 0
                        ? `no consumers, ${waiting} job(s) waiting`
                        : 'no consumers, queue empty'
            } else if (waiting > QUEUE_BACKLOG_HINT) {
                checks.videoWorker = `${consumers} consumer(s) but ${waiting} job(s) waiting`
            }
        } catch (error) {
            checks.videoWorker =
                error instanceof Error ? error.message : 'fail'
        }

        // Set the status rather than throwing: the global error filter
        // rewrites HttpException bodies into its own shape, which dropped the
        // `checks` map — so a failing probe said "Http Exception" and not which
        // dependency was down. The detail is the entire point of this endpoint.
        if (!allOk) {
            res.status(HttpStatus.SERVICE_UNAVAILABLE)
            return { status: 'not_ready', checks }
        }

        return { status: 'ok', checks }
    }
}
