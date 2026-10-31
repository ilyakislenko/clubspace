import {
    DynamicModule,
    Global,
    Inject,
    Injectable,
    Logger,
    Module,
    OnApplicationShutdown,
} from '@nestjs/common'
import Redis from 'ioredis'

import { REDIS_CLIENT, RedisConfig } from './redis.constants'

// Closes the shared connection on shutdown so app.close() doesn't hang on an
// open socket.
@Injectable()
class RedisShutdown implements OnApplicationShutdown {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    async onApplicationShutdown(): Promise<void> {
        await this.redis.quit().catch(() => this.redis.disconnect())
    }
}

// One ioredis connection shared by everything outside BullMQ (rate-limit
// counters, short-lived caches). Global, so features inject REDIS_CLIENT
// without importing this module.
@Global()
@Module({})
export class RedisModule {
    static forRoot(config: RedisConfig): DynamicModule {
        return {
            module: RedisModule,
            providers: [
                {
                    provide: REDIS_CLIENT,
                    useFactory: (): Redis => {
                        const logger = new Logger('Redis')
                        const client = new Redis({
                            host: config.host,
                            port: config.port,
                            password: config.password,
                            db: config.db,
                            // Connect on first command: unit-test fixtures
                            // build the module without a Redis to talk to.
                            lazyConnect: true,
                        })
                        // Without a listener ioredis rethrows connection errors
                        // as unhandled; reconnects are automatic.
                        client.on('error', (err: Error) =>
                            logger.warn(`redis: ${err.message}`),
                        )
                        return client
                    },
                },
                RedisShutdown,
            ],
            exports: [REDIS_CLIENT],
        }
    }
}
