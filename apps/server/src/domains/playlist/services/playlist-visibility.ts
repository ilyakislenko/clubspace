// Pure helper that builds the visibility AND-clause array for course
// queries. Lifted out of the service so we can unit test it without
// instantiating Prisma. The shape returned is what list/get use as
// `where.AND` when scoping students to public + already-published rows.

export type CourseVisibilityClauses = ReadonlyArray<
    | { isPublic: true }
    | { OR: ReadonlyArray<{ publishedAt: null } | { publishedAt: { lte: Date } }> }
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
    ] as const
}
