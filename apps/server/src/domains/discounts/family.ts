// The family discount's condition (docs/design/2026-11-15-discounts.md §3.1).
// A buyer's family is everyone one confirmed guardianship step away (parents,
// children), plus the other dependents of the buyer's guardians (siblings) and
// the other guardians of the buyer's dependents (co-parents): two hops in the
// graph of confirmed (consentAt set) guardianships. The buyer qualifies when
// another family member holds a current abonement of this club, paid or not —
// a sale is a sale. currentSubscriptionWhere requires a membership, so a former
// member never counts; the owner never holds an abonement, so never counts.
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { currentSubscriptionWhere } from '../subscriptions/current-subscriptions'

type Db = Pick<PrismaTransactionClientType, 'guardianship' | 'subscription'>

export const loadFamilyMemberIds = async (db: Db, userId: string): Promise<string[]> => {
    const direct = await db.guardianship.findMany({
        where: {
            consentAt: { not: null },
            OR: [{ guardianId: userId }, { dependentId: userId }],
        },
        select: { guardianId: true, dependentId: true },
    })
    const guardians = direct.filter((g) => g.dependentId === userId).map((g) => g.guardianId)
    const dependents = direct.filter((g) => g.guardianId === userId).map((g) => g.dependentId)
    const second =
        guardians.length + dependents.length > 0
            ? await db.guardianship.findMany({
                  where: {
                      consentAt: { not: null },
                      OR: [
                          ...(guardians.length > 0 ? [{ guardianId: { in: guardians } }] : []),
                          ...(dependents.length > 0 ? [{ dependentId: { in: dependents } }] : []),
                      ],
                  },
                  select: { guardianId: true, dependentId: true },
              })
            : []
    const family = new Set<string>([...guardians, ...dependents])
    for (const g of second) {
        // Siblings: other dependents of my guardians; co-parents: other
        // guardians of my dependents.
        if (guardians.includes(g.guardianId)) family.add(g.dependentId)
        if (dependents.includes(g.dependentId)) family.add(g.guardianId)
    }
    family.delete(userId)
    return [...family]
}

export const loadFamilyEligibility = async (
    db: Db,
    p: { workspaceId: string; userId: string; now: Date },
): Promise<boolean> => {
    const family = await loadFamilyMemberIds(db, p.userId)
    if (family.length === 0) return false
    const holder = await db.subscription.findFirst({
        where: {
            workspaceId: p.workspaceId,
            userId: { in: family },
            ...currentSubscriptionWhere(p.now),
        },
        select: { id: true },
    })
    return holder !== null
}
