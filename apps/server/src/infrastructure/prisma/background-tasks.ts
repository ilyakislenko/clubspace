/**
 * Work a request starts but does not wait for: an audit entry written after
 * the guard already let the request through, pushes that follow a committed
 * check-in, a cache write the caller does not need. Untracked, such a promise
 * outlives `app.close()` — it reconnects Prisma after shutdown disconnected
 * it and leaves a pool nothing will ever end (in the e2e suite: a query from
 * the previous spec file landing after jest tore its environment down).
 *
 * `run` starts the task at once and never rejects; `drain` resolves once
 * every task has settled, including tasks started while draining.
 * PrismaService drains before it disconnects.
 */
export class BackgroundTasks {
    private readonly inFlight = new Set<Promise<void>>()

    constructor(private readonly onError: (err: unknown) => void) {}

    run(task: () => Promise<unknown>): void {
        let started: Promise<unknown>
        try {
            started = task()
        } catch (err) {
            started = Promise.reject(err)
        }
        const tracked: Promise<void> = started
            .then(
                () => undefined,
                (err: unknown) => this.onError(err),
            )
            .finally(() => this.inFlight.delete(tracked))
        this.inFlight.add(tracked)
    }

    async drain(): Promise<void> {
        while (this.inFlight.size > 0) {
            await Promise.all([...this.inFlight])
        }
    }
}
