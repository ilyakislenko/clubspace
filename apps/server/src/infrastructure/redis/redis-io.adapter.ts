import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import type Redis from 'ioredis'
import type { Server, ServerOptions } from 'socket.io'

/**
 * socket.io adapter that fans every emit out through Redis pub/sub, so an
 * `invalidate` raised on one API replica reaches sockets connected to any
 * other (RealtimeEmitter emits into rooms on the local server only). Built on
 * the shared REDIS_CLIENT config: pub/sub need connections of their own, so
 * both are duplicates of it and are closed with the app.
 *
 * The adapter is installed on the root server in createIOServer, before the
 * `/realtime` namespace exists — a namespace takes its adapter at creation.
 */
export class RedisIoAdapter extends IoAdapter {
    private pub: Redis | null = null
    private sub: Redis | null = null
    private adapterConstructor: ReturnType<typeof createAdapter> | null = null

    constructor(app: INestApplicationContext, private readonly redis: Redis) {
        super(app)
    }

    async connect(): Promise<void> {
        const pub = this.redis.duplicate()
        const sub = this.redis.duplicate()
        // The shared client is lazyConnect; duplicates inherit that option.
        await Promise.all([pub.connect(), sub.connect()])
        this.pub = pub
        this.sub = sub
        this.adapterConstructor = createAdapter(pub, sub)
    }

    override createIOServer(port: number, options?: ServerOptions): Server {
        if (!this.adapterConstructor) {
            throw new Error('RedisIoAdapter.connect() must finish before the app starts listening')
        }
        const server: Server = super.createIOServer(port, options)
        server.adapter(this.adapterConstructor)
        return server
    }

    override async dispose(): Promise<void> {
        await super.dispose()
        await Promise.all(
            [this.pub, this.sub].map((client) =>
                client?.quit().catch(() => client.disconnect()),
            ),
        )
        this.pub = null
        this.sub = null
    }
}
