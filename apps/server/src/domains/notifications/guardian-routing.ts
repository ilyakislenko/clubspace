import { PrismaService, UserStatus } from '../../infrastructure/prisma'

// A dependent (child profile, no login) has no devices, inbox reader or
// e-mail: everything addressed to one goes to each of its confirmed guardians
// instead, prefixed with the child's name and tagged with `dependentId` so the
// app opens it in that child's profile.
export type GuardianRoute = { guardianIds: string[]; dependentName: string }

export const loadGuardianRoutes = async (
    prisma: Pick<PrismaService, 'guardianship'>,
    userIds: string[],
): Promise<Map<string, GuardianRoute>> => {
    const routes = new Map<string, GuardianRoute>()
    const unique = [...new Set(userIds)]
    if (unique.length === 0) return routes
    const links = await prisma.guardianship.findMany({
        where: {
            dependentId: { in: unique },
            consentAt: { not: null },
            dependent: { status: UserStatus.ACTIVE },
            guardian: { status: UserStatus.ACTIVE },
        },
        select: {
            dependentId: true,
            guardianId: true,
            dependent: { select: { firstname: true } },
        },
    })
    for (const link of links) {
        const route = routes.get(link.dependentId) ?? {
            guardianIds: [],
            dependentName: link.dependent.firstname?.trim() || 'Ребёнок',
        }
        route.guardianIds.push(link.guardianId)
        routes.set(link.dependentId, route)
    }
    return routes
}

export const guardianTopic = (route: GuardianRoute, topic: string): string =>
    `${route.dependentName}: ${topic}`

type Routable = {
    userId: string
    topic: string
    message: string
    metadata: Record<string, unknown>
}

// Rewrites a batch: rows of dependents become one row per guardian. A guardian
// who already gets the very same notice directly in this batch (both parent
// and child are members of the club) gets no copy for the child.
export const routeToGuardians = <T extends Routable>(
    rows: T[],
    routes: Map<string, GuardianRoute>,
): T[] => {
    if (routes.size === 0) return rows
    const direct = new Set(
        rows
            .filter((r) => !routes.has(r.userId))
            .map((r) => `${r.userId}|${r.topic}|${r.message}`),
    )
    return rows.flatMap((row) => {
        const route = routes.get(row.userId)
        if (!route) return [row]
        return route.guardianIds
            .filter((g) => !direct.has(`${g}|${row.topic}|${row.message}`))
            .map((guardianId) => ({
                ...row,
                userId: guardianId,
                topic: guardianTopic(route, row.topic),
                metadata: { ...row.metadata, dependentId: row.userId },
            }))
    })
}
