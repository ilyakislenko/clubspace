import { BackgroundTasks } from './background-tasks'

// Promise.withResolvers is ES2024; the server compiles against ES2022.
const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

describe('BackgroundTasks', () => {
    it('drain waits for a task that is still running', async () => {
        const tasks = new BackgroundTasks(jest.fn())
        const gate = deferred()
        let done = false
        tasks.run(async () => {
            await gate.promise
            done = true
        })

        let drained = false
        const draining = tasks.drain().then(() => (drained = true))
        await Promise.resolve()
        expect(drained).toBe(false)

        gate.resolve()
        await draining
        expect(done).toBe(true)
    })

    it('drain also waits for tasks started while draining', async () => {
        const tasks = new BackgroundTasks(jest.fn())
        const first = deferred()
        const second = deferred()
        let secondDone = false
        tasks.run(async () => {
            await first.promise
            tasks.run(async () => {
                await second.promise
                secondDone = true
            })
        })

        const draining = tasks.drain()
        first.resolve()
        await new Promise((r) => setImmediate(r))
        second.resolve()
        await draining
        expect(secondDone).toBe(true)
    })

    it('reports a failure instead of rejecting, and drain still resolves', async () => {
        const onError = jest.fn()
        const tasks = new BackgroundTasks(onError)
        const boom = new Error('boom')
        tasks.run(() => Promise.reject(boom))
        tasks.run(() => {
            throw boom
        })

        await expect(tasks.drain()).resolves.toBeUndefined()
        expect(onError).toHaveBeenCalledTimes(2)
        expect(onError).toHaveBeenCalledWith(boom)
    })

    it('drain resolves at once with nothing in flight', async () => {
        const tasks = new BackgroundTasks(jest.fn())
        tasks.run(async () => undefined)
        await tasks.drain()
        await expect(tasks.drain()).resolves.toBeUndefined()
    })
})
