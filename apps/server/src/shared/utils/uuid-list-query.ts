import { z } from 'zod'

/**
 * A list of ids in a query string, comma-separated (`?ids=a,b`). The API
 * contract stays a plain string; the handler gets a uuid array. Empty = [].
 */
export const uuidListQuery = (max: number) =>
    z
        .string()
        .transform((value) => (value === '' ? [] : value.split(',')))
        .pipe(z.array(z.uuid()).max(max))
