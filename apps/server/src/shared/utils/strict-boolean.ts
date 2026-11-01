import { z } from 'zod'

/**
 * A boolean request field that accepts `true`/`false` and the strings
 * `'true'`/`'false'` (query strings and form bodies) — nothing else.
 * `z.coerce.boolean()` must never be used for input: it is `Boolean(value)`,
 * so the string `'false'` becomes `true` and publishes a video.
 * The preprocess keeps the OpenAPI type a plain `boolean`.
 */
export const strictBoolean = () =>
    z.preprocess(
        (value) => (value === 'true' ? true : value === 'false' ? false : value),
        z.boolean(),
    )
