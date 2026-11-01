import { IoAdapter } from '@nestjs/platform-socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import type Redis from 'ioredis'

import { RedisIoAdapter } from './redis-io.adapter'

jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn() }))

const fakeConnection = () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
})

const setup = () => {
    const pub = fakeConnection()
    const sub = fakeConnection()
    const duplicate = jest.fn().mockReturnValueOnce(pub).mockReturnValueOnce(sub)
    const redis = { duplicate } as unknown as Redis
    const adapter = new RedisIoAdapter(undefined as never, redis)
    return { adapter, pub, sub, duplicate }
}

describe('RedisIoAdapter', () => {
    const adapterConstructor = jest.fn()
    const server = { adapter: jest.fn() }

    beforeEach(() => {
        jest.mocked(createAdapter).mockReset().mockReturnValue(adapterConstructor as never)
        server.adapter.mockReset()
        jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server)
        jest.spyOn(IoAdapter.prototype, 'dispose').mockResolvedValue(undefined)
    })
    afterEach(() => jest.restoreAllMocks())

    it('builds the pub/sub pair from dedicated connections, never the shared client', async () => {
        const { adapter, pub, sub, duplicate } = setup()
        await adapter.connect()
        expect(duplicate).toHaveBeenCalledTimes(2)
        expect(pub.connect).toHaveBeenCalled()
        expect(sub.connect).toHaveBeenCalled()
        expect(createAdapter).toHaveBeenCalledWith(pub, sub)
    })

    it('installs the Redis adapter on the root server it creates', async () => {
        const { adapter } = setup()
        await adapter.connect()
        expect(adapter.createIOServer(0, {})).toBe(server)
        expect(server.adapter).toHaveBeenCalledWith(adapterConstructor)
    })

    it('refuses to create a server before connecting, instead of silently going single-replica', () => {
        const { adapter } = setup()
        expect(() => adapter.createIOServer(0, {})).toThrow(/connect\(\)/)
        expect(server.adapter).not.toHaveBeenCalled()
    })

    it('closes both connections on dispose, falling back to disconnect when quit fails', async () => {
        const { adapter, pub, sub } = setup()
        await adapter.connect()
        sub.quit.mockRejectedValueOnce(new Error('closed'))
        await adapter.dispose()
        expect(pub.quit).toHaveBeenCalled()
        expect(pub.disconnect).not.toHaveBeenCalled()
        expect(sub.disconnect).toHaveBeenCalled()
    })
})
