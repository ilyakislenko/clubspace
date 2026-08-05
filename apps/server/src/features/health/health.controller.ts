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

// A dead SMTP host can leave a TCP connect hanging far longer than a probe
// should wait, so the mail check is bounded. Slower than this is "broken" for
// readiness purposes even if it would eventually answer.
const SMTP_VERIFY_TIMEOUT_MS = 5000

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`timed out after ${ms}ms`)),
                    ms,
                )
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

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
