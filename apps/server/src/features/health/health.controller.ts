import { InjectQueue } from '@nestjs/bullmq'
import {
    Controller,
    Get,
    HttpCode,
    HttpException,
    HttpStatus,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Queue } from 'bullmq'

import { PrismaService } from '../../infrastructure/prisma'

@Controller()
@SkipThrottle()
export class HealthController {
    constructor(
        private readonly prisma: PrismaService,
        @InjectQueue('video-transcode') private readonly queue: Queue,
    ) {}

    @Get('healthz')
    @HttpCode(HttpStatus.OK)
    healthz() {
        return { status: 'ok' }
    }

    @Get('readyz')
    async readyz() {
        const checks: Record<string, 'ok' | string> = {
            db: 'ok',
            redis: 'ok',
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

        if (!allOk) {
            throw new HttpException(
                { status: 'not_ready', checks },
                HttpStatus.SERVICE_UNAVAILABLE,
            )
        }

        return { status: 'ok', checks }
    }
}
