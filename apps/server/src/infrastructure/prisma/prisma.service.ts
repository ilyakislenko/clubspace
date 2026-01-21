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

    constructor(
        @Inject(PRISMA_CONFIG)
        private readonly config: PrismaConfig,
    ) {
        const adapter = new PrismaPg({ connectionString: config.url })

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
            setInterval(
                () =>
                    this.$queryRaw`SELECT 1`.catch((err) =>
                        this.logger.error(err, err.stack),
                    ),
                5 * 60000,
            )
        } catch (err: any) {
            if (!String(err).includes('fake')) {
                this.logger.error(err, err.stack)
            }
            this.$disconnect()
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect()
    }
}
