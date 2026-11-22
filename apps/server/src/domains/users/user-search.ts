import type { Prisma } from '../../infrastructure/prisma'

// More words than this in a search add nothing but query cost.
const MAX_SEARCH_TERMS = 5

// One filter per word of the query: each must appear in the person's name,
// e-mail or phone, or in one of a child's guardians' (the guardian is who the
// club knows). AND them on the relation that points at the user.
export const userSearchWhere = (q: string): Prisma.UserWhereInput[] =>
    q
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, MAX_SEARCH_TERMS)
        .map((term) => {
            const contains = { contains: term, mode: 'insensitive' as const }
            const person: Prisma.UserWhereInput[] = [
                { firstname: contains },
                { lastname: contains },
                { email: contains },
                { phone: contains },
            ]
            return {
                OR: [
                    ...person,
                    {
                        dependentOf: {
                            some: {
                                guardian: { status: 'ACTIVE', OR: person },
                            },
                        },
                    },
                ],
            }
        })
