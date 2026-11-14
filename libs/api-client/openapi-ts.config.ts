import { defineConfig } from '@hey-api/openapi-ts'

// Second step of `nx types:generate` (run from the workspace root, after the
// types step that cleans libs/api-client/src/openapi — not a second job here:
// jobs run concurrently and the types job would wipe this output).
//
// JSON schemas of the request bodies only (`*Input` / `*InputDto` / `*Body`), so a form
// reads a field's limits (maxLength, maximum…) from the contract instead of
// retyping them — see apps/admin/src/shared/lib/contract-limits.ts. Inputs
// only: the full set is ~1.5 MB of literals nobody reads.
export default defineConfig({
    input: 'open-api.json',
    output: 'libs/api-client/src/openapi/schemas',
    // Operations drop out with the excluded output schemas; `orphans` keeps
    // the input schemas they leave unreferenced.
    parser: { filters: { orphans: true, schemas: { include: ['/(Input|InputDto|Body)$/'] } } },
    plugins: ['@hey-api/schemas'],
})
