import { MemberStatus, type PrismaService } from '../../infrastructure/prisma'
import { isMuteExempt } from './notification-mute'
import type { NotificationCategoryKey } from './services/preferences.service'

type GatedRow = {
    userId: string
    // The opt-out category the producer was called with; not persisted.
    category?: NotificationCategoryKey
    metadata: { kind: string; workspaceId?: unknown; dependentId?: unknown }
}

// Rows routed to a guardian (metadata.dependentId, set by routeToGuardians)
// are checked against the guardian, the person who actually gets them: their
// category opt-out (a missing prefs row = on) and their own mute of that club
// (mute-exempt kinds still pass). Direct rows pass untouched — their recipient
// was checked upstream. Two queries at most for the whole batch
// (docs/design/2026-11-26-parent-pays-for-child.md §3.4).
export const filterRoutedRows = async <T extends GatedRow>(
    prisma: Pick<PrismaService, 'notificationPreferences' | 'workspaceMember'>,
    rows: T[],
): Promise<T[]> => {
    const routed = rows.filter((r) => typeof r.metadata.dependentId === 'string')
    if (routed.length === 0) return rows
    const categorized = routed.filter((r) => r.category !== undefined)
    const muteable = routed.filter(
        (r) => typeof r.metadata.workspaceId === 'string' && !isMuteExempt(r.metadata.kind),
    )
    const [prefs, muted] = await Promise.all([
        categorized.length > 0
            ? prisma.notificationPreferences.findMany({
                  where: { userId: { in: [...new Set(categorized.map((r) => r.userId))] } },
              })
            : [],
        muteable.length > 0
            ? prisma.workspaceMember.findMany({
                  where: {
                      userId: { in: [...new Set(muteable.map((r) => r.userId))] },
                      workspaceId: {
                          in: [...new Set(muteable.map((r) => r.metadata.workspaceId as string))],
                      },
                      status: MemberStatus.ACTIVE,
                      notificationsMuted: true,
                  },
                  select: { userId: true, workspaceId: true },
              })
            : [],
    ])
    const prefsByUser = new Map(prefs.map((p) => [p.userId, p]))
    const mutedKeys = new Set(muted.map((m) => `${m.workspaceId}:${m.userId}`))
    return rows.filter((r) => {
        if (typeof r.metadata.dependentId !== 'string') return true
        if (r.category && prefsByUser.get(r.userId)?.[r.category] === false) return false
        return !(
            typeof r.metadata.workspaceId === 'string' &&
            !isMuteExempt(r.metadata.kind) &&
            mutedKeys.has(`${r.metadata.workspaceId}:${r.userId}`)
        )
    })
}
