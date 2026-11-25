import type { PrismaService } from '../../infrastructure/prisma'
import { type CallList, narrowCallList } from '../retention/call-list'
import { renewalDueUserIds } from '../subscriptions/renewal-rules'
import {
    type MessageScope,
    scopeMemberWhere,
    type SegmentTarget,
    segmentMemberWhere,
} from './segment-where'

// The students a message goes to right now (send time: a scheduled message
// reaches whoever is due then; the compose preview counts «сейчас»). The
// call list comes from the caller: the request path reads the cached one the
// sender is looking at, the dispatcher computes it fresh.
export const resolveSegmentUserIds = async (
    prisma: Pick<PrismaService, 'workspace' | 'workspaceMember'>,
    p: {
        workspaceId: string
        ownerId: string
        target: SegmentTarget
        scope: MessageScope
        now: Date
        callList: () => Promise<CallList>
    },
): Promise<string[]> => {
    let resolvedIds: string[] | undefined
    if (p.target.segment === 'RENEW') {
        const memberWhere = scopeMemberWhere(p.scope)
        resolvedIds = await renewalDueUserIds(prisma, p.workspaceId, p.now, {
            ...(memberWhere ? { memberWhere } : {}),
        })
    } else if (p.target.segment === 'CALL_LIST') {
        const list = await p.callList()
        resolvedIds = narrowCallList(
            list.entries,
            p.scope.groupIds === null ? null : new Set(p.scope.groupIds),
        )
            .filter((e) => !e.snoozed)
            .map((e) => e.userId)
    }
    if (resolvedIds?.length === 0) return []
    const rows = await prisma.workspaceMember.findMany({
        where: segmentMemberWhere({ ...p, resolvedIds }),
        select: { userId: true },
    })
    return [...new Set(rows.map((r) => r.userId))]
}
