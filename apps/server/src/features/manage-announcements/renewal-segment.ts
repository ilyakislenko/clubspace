import { Prisma } from '../../infrastructure/prisma'

const WINDOW_DAYS = 7

// The "due for renewal" segment: access expiring within a week (incl. already
// expired) OR a class-pack down to its last visit. One rule, expressed two ways
// so the push fan-out (a Prisma filter) and the feed (a per-member predicate)
// stay in sync.
export const expiringSegmentWhere = (
    now = new Date(),
): Prisma.WorkspaceMemberWhereInput => {
    const soon = new Date(now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000)
    return {
        OR: [
            { accessUntil: { lte: soon } },
            { subscription: { classesRemaining: { lte: 1 } } },
        ],
    }
}

export const isExpiringMember = (
    m: { accessUntil: Date | null; classesRemaining: number | null },
    now = new Date(),
): boolean => {
    const soon = now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000
    const accessExpiring =
        m.accessUntil != null && m.accessUntil.getTime() <= soon
    const lowClasses = m.classesRemaining != null && m.classesRemaining <= 1
    return accessExpiring || lowClasses
}
