import type { PrismaService } from '../../infrastructure/prisma'

// Kinds that still reach a member who muted the club. Mute is for the club's
// chatter (announcements, new videos, reminders, achievements); money, access,
// membership and changes to something the person booked (or runs — a
// substitution) must not go quiet.
const EXEMPT_PREFIXES = [
    'subscription.',
    'access.',
    'classes.',
    'freeze.',
    'personal.',
    'substitution.',
]
const EXEMPT_KINDS: Record<string, true> = {
    'member.approved': true,
    'member.invitation': true,
    'dropin.cancelled': true,
    'exception.notify': true,
    'grading.moved': true,
    'grading.cancelled': true,
}

export const isMuteExempt = (kind: string): boolean =>
    Object.hasOwn(EXEMPT_KINDS, kind) ||
    EXEMPT_PREFIXES.some((p) => kind.startsWith(p))

// A notification without a club or with an exempt kind is never muted.
export const isMutedFor = async (
    prisma: Pick<PrismaService, 'workspaceMember'>,
    p: { userId: string; workspaceId?: unknown; kind: string },
): Promise<boolean> => {
    if (typeof p.workspaceId !== 'string' || isMuteExempt(p.kind)) return false
    const row = await prisma.workspaceMember.findUnique({
        where: {
            userId_workspaceId: { userId: p.userId, workspaceId: p.workspaceId },
        },
        select: { notificationsMuted: true },
    })
    return row?.notificationsMuted === true
}

// Batch form for fan-outs: one query for the whole set of rows, returning the
// rows that should still be written.
export const filterMuted = async <
    T extends { userId: string; metadata: { kind: string; workspaceId?: unknown } },
>(
    prisma: Pick<PrismaService, 'workspaceMember'>,
    rows: T[],
): Promise<T[]> => {
    const candidates = rows.filter(
        (r) =>
            typeof r.metadata.workspaceId === 'string' &&
            !isMuteExempt(r.metadata.kind),
    )
    if (candidates.length === 0) return rows
    const muted = await prisma.workspaceMember.findMany({
        where: {
            notificationsMuted: true,
            userId: { in: [...new Set(candidates.map((r) => r.userId))] },
            workspaceId: {
                in: [
                    ...new Set(candidates.map((r) => r.metadata.workspaceId as string)),
                ],
            },
        },
        select: { userId: true, workspaceId: true },
    })
    if (muted.length === 0) return rows
    const mutedKeys = new Set(muted.map((m) => `${m.workspaceId}:${m.userId}`))
    return rows.filter(
        (r) =>
            typeof r.metadata.workspaceId !== 'string' ||
            isMuteExempt(r.metadata.kind) ||
            !mutedKeys.has(`${r.metadata.workspaceId}:${r.userId}`),
    )
}
