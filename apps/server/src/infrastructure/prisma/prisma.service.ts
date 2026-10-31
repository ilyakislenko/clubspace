import {
    Inject,
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

import type { PrismaConfig } from './prisma.config';
import { PRISMA_CONFIG } from './prisma.config';


@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy
{
    public static instance: PrismaService

    private logger = new Logger(PrismaService.name)
    private keepAlive?: ReturnType<typeof setInterval>

    constructor(
        @Inject(PRISMA_CONFIG)
        private readonly config: PrismaConfig,
    ) {
        const adapter = new PrismaPg({
            connectionString: config.url,
            max: config.poolMax,
        })

        super({
            adapter,
            log: [
                {
                    emit: 'event',
                    level: 'query',
                },
                {
                    emit: 'event',
                    level: 'error',
                },
            ],
        })

        PrismaService.instance = this
    }

    async onModuleInit(): Promise<void> {
        const { logging, maxQueryExecutionTime } = this.config

        try {
            ;(PrismaService.instance as any).$on('query', (e: any) => {
                if (logging === 'all_queries') {
                    if (e.query !== 'SELECT 1') {
                        this.logger.log(
                            `query: ${e.query}, params: ${e.params}, duration: ${e.duration}`,
                        )
                    }
                }
                if (logging === 'long_queries') {
                    if (
                        maxQueryExecutionTime &&
                        e.duration >= maxQueryExecutionTime
                    ) {
                        this.logger.warn(
                            `query is slow: ${e.query}, params: ${e.params}, execution time: ${e.duration}`,
                        )
                    }
                }
            })
            await this.$connect()
            this.keepAlive = setInterval(
                () =>
                    this.$queryRaw`SELECT 1`.catch((err) =>
                        this.logger.error(err, err.stack),
                    ),
                5 * 60000,
            )
            // Don't let the keep-alive timer hold the process open on shutdown.
            this.keepAlive.unref?.()
        } catch (err: any) {
            // Test fixtures use a placeholder ("fake") connection string and
            // intentionally never connect — stay quiet and don't crash there.
            if (String(err).includes('fake')) {
                await this.$disconnect().catch(() => undefined)
                return
            }
            // Otherwise the database is genuinely unreachable. Fail fast so the
            // orchestrator restarts the container instead of the server booting
            // and silently serving 500s with no DB.
            this.logger.error(err, err.stack)
            await this.$disconnect().catch(() => undefined)
            throw err
        }
    }

    async onModuleDestroy(): Promise<void> {
        if (this.keepAlive) {
            clearInterval(this.keepAlive)
        }
        await this.$disconnect()
    }
}
