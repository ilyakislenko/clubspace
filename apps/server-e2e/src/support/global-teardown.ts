import type { Client } from 'pg'

// The test database is left in place so the next run skips the create and the
// `db push`; each suite truncates what it needs anyway. Drop it by hand if the
// schema ever gets into a state `db push` can't reconcile:
//
//   docker exec bjj-academy-postgres-1 psql -U postgres \
//     -c 'DROP DATABASE clubspace_e2e'
//
// The one thing to clean up is the advisory lock claimed in global-setup.
// Postgres would release it when the connection dies anyway — that is why a
// killed run never wedges the suite — but closing it here means jest exits
// promptly instead of waiting on an idle socket.
module.exports = async function globalTeardown() {
    const lockClient = (globalThis as { __e2eLockClient?: Client })
        .__e2eLockClient
    if (lockClient) {
        await lockClient.end().catch(() => undefined)
    }
}
