import type { PrismaService } from '../../infrastructure/prisma'
import type { CallListCacheService } from '../retention/call-list-cache.service'

// A direct message written from «Кому позвонить» logs «Связались» when it is
// sent (send-club-message.handler.ts) and keeps the contact's id. If the
// message never goes out — cancelled by hand, or because its author left —
// the contact didn't happen: it is removed and the member is back on the
// call list on every surface.
export const dropMessageContact = async (
    prisma: Pick<PrismaService, 'memberRetentionContact'>,
    callLists: Pick<CallListCacheService, 'invalidate'>,
    message: { workspaceId: string; contactId: string | null },
): Promise<void> => {
    if (!message.contactId) return
    const { count } = await prisma.memberRetentionContact.deleteMany({
        where: { id: message.contactId, workspaceId: message.workspaceId },
    })
    if (count > 0) await callLists.invalidate(message.workspaceId)
}
