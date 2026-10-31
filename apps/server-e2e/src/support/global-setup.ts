import { execFileSync } from 'child_process'
import * as path from 'path'
import { Client } from 'pg'

import { TEST_DATABASE_URL } from './env'

// Creates the throwaway database once per run and syncs the Prisma schema into
// it. The suite talks to a real Postgres on purpose: the bugs worth catching
// here — a guard that never fires, a serializer that drops a field, a unique
// constraint nobody accounted for, a `where` that silently matches nothing —
// all pass against a jest.fn() returning whatever the spec author expected.
module.exports = async function globalSetup() {
    const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '')

    const adminUrl = new URL(TEST_DATABASE_URL)
    adminUrl.pathname = '/postgres'
    adminUrl.search = ''

    const admin = new Client({ connectionString: adminUrl.toString() })
    try {
        await admin.connect()
    } catch (error) {
        throw new Error(
            `Cannot reach Postgres at ${adminUrl.host}. Start the local stack ` +
                `with \`npm run dev:infra\` before running the e2e suite.\n` +
                `Original error: ${
                    error instanceof Error ? error.message : String(error)
                }`,
        )
    }

    await claimExclusiveRun(adminUrl.toString(), dbName)

    const existing = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName],
    )
    if (existing.rowCount === 0) {
        // An identifier can't be parameterised. dbName comes from our own
        // default or from E2E_DATABASE_URL — never from request data.
        await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`)
    }
    await admin.end()

    // `db push`, not `migrate deploy`: this repo deliberately has no
    // migrations directory (no production data yet), so schema.prisma is the
    // only source of truth. --accept-data-loss is safe on a database whose
    // entire purpose is being truncated between tests.
    execFileSync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
        cwd: path.resolve(__dirname, '../../../server'),
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
        stdio: 'pipe',
    })

    await flushTestRedis()
}

// Two e2e runs against the same database truncate each other's fixtures
// mid-assertion, and the resulting wall of unrelated failures looks exactly
// like a broken branch. Easy to hit by accident: `npm run test:e2e` in one
// terminal while `npm run verify` is running in another.
//
// A session-scoped Postgres advisory lock is the right shape — it is released
// automatically when this connection dies, so a killed run never leaves the
// suite wedged. The connection is deliberately never closed: releasing it
// would drop the lock while the tests are still going.
// Arbitrary but fixed namespace. Two resources are locked: the test database
// and the Redis target the suite flushes (db 15 on REDIS_HOST:REDIS_PORT). Runs
// against different databases AND different Redis instances on the same
// Postgres server (E2E_DATABASE_URL / E2E_REDIS_PORT) don't block each other;
// sharing either one still fails fast. The locks are taken on the admin
// connection because the test database may not exist yet.
const RUN_LOCK_NAMESPACE = 728_401_553

const claimExclusiveRun = async (connectionString: string, dbName: string) => {
    // Its own connection, held open for the whole run. The lock is scoped to
    // the session, so closing this would release it while tests are still
    // going; parking it on globalThis also keeps it from being collected.
    const lockClient = new Client({ connectionString })
    await lockClient.connect()

    const redisTarget = `redis ${process.env.REDIS_HOST ?? 'localhost'}:${process.env.REDIS_PORT ?? 6379}`
    for (const resource of [dbName, redisTarget]) {
        const { rows } = await lockClient.query<{ locked: boolean }>(
            'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
            [RUN_LOCK_NAMESPACE, resource],
        )
        if (!rows[0]?.locked) {
            await lockClient.end()
            throw new Error(
                `Another e2e run already holds the lock on ${resource}. Two ` +
                    `runs sharing one database or one Redis delete each ` +
                    `other's fixtures mid-assertion, which surfaces as a wall ` +
                    `of unrelated failures. Wait for the first run to finish.`,
            )
        }
    }

    ;(globalThis as { __e2eLockClient?: Client }).__e2eLockClient = lockClient
}

// BullMQ persists the scheduler's repeatable job, so entries accumulate in the
// test database across runs. The suite overrides the processor so none of them
// execute, but leaving hundreds of stale delayed keys behind is untidy and
// makes anyone inspecting Redis think the suite is scheduling work.
const flushTestRedis = async () => {
    const db = Number(process.env.REDIS_DB)
    // Refuse to touch anything but the dedicated test database. Getting this
    // wrong would wipe the queues of a locally running server.
    if (db !== 15) {
        throw new Error(
            `Refusing to flush Redis db ${db}: the e2e suite must run against ` +
                `db 15. Check apps/server-e2e/src/support/env.ts.`,
        )
    }

    const IORedis = (await import('ioredis')).default
    const redis = new IORedis({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        db,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
    })
    try {
        await redis.connect()
        await redis.flushdb()
    } catch {
        // Redis being unreachable is the app's problem to report on boot, with
        // a better message than this helper could give.
    } finally {
        redis.disconnect()
    }
}
