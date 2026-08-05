// Nothing to tear down: the app is booted in-process per suite and closed in
// afterAll, and the test database is left in place so the next run skips the
// create + `db push` (each suite truncates what it needs anyway). Drop it by
// hand if the schema ever gets into a state `db push` can't reconcile:
//
//   docker exec bjj-academy-postgres-1 psql -U postgres \
//     -c 'DROP DATABASE clubspace_e2e'
module.exports = async function globalTeardown() {
    // intentionally empty
}
