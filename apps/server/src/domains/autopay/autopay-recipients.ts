import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { CLUB_ADMINS } from '../../shared/decorators/roles.decorator'

// Who hears about a member's autopay trouble (a decline, a stop, a charge
// that was not granted, a setup YooKassa refused): the money people — the
// owner (who has no WorkspaceMember row) and every ACTIVE club admin.
export const findAutopayStaffRecipients = async (
    db: Pick<PrismaTransactionClientType, 'workspaceMember'>,
    p: { workspaceId: string; ownerId: string },
): Promise<string[]> => {
    const admins = await db.workspaceMember.findMany({
        where: {
            workspaceId: p.workspaceId,
            status: 'ACTIVE',
            role: { name: { in: CLUB_ADMINS } },
        },
        select: { userId: true },
    })
    return [...new Set([p.ownerId, ...admins.map((m) => m.userId)])]
}
