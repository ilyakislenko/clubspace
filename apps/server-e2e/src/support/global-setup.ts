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
}
