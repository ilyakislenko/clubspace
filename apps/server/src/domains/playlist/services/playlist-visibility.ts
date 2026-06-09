// Pure helper that builds the visibility AND-clause array for course
// queries. Lifted out of the service so we can unit test it without
// instantiating Prisma. The shape returned is what list/get use as
// `where.AND` when scoping students to public + already-published rows.

// Mutable array shape — Prisma's CourseWhereInput['AND'] expects
// mutable arrays, so the helper returns a plain Array<...> instead of
// ReadonlyArray. Callers must not mutate the result anyway; this is
// purely about matching Prisma's type variance.
export type CourseVisibilityClauses = Array<
    | { isPublic: true }
    | { OR: Array<{ publishedAt: null } | { publishedAt: { lte: Date } }> }
>

export const buildCourseVisibilityClauses = (params: {
    includeUnpublished?: boolean
    now?: Date
}): CourseVisibilityClauses => {
    if (params.includeUnpublished) return []
    const now = params.now ?? new Date()
    return [
        { isPublic: true },
        {
            OR: [
                { publishedAt: null },
                { publishedAt: { lte: now } },
            ],
        },
    ]
}
