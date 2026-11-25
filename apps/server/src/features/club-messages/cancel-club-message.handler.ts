import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { dropMessageContact } from '../../domains/messages/contact'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { CallListCacheService } from '../../domains/retention/call-list-cache.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CancelClubMessageFeature,
    type CancelClubMessageFeatureResponse,
} from './cancel-club-message.feature'
import { clubMessageSelect, loadClubMessageOutput } from './schemas'
import { loadVisibleMessage, resolveMessageViewer } from './visibility'

// «⋯ → Отменить отправку» of a scheduled message: its author or a sport lead
// (the only ones who see it). The status flip races the dispatcher's claim;
// whichever lands first wins. A «Связались» the message logged is taken back.
@Feature(CancelClubMessageFeature)
export class CancelClubMessageHandler
    implements IFeatureHandler<CancelClubMessageFeature, CancelClubMessageFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly callLists: CallListCacheService,
    ) {}

    async execute(f: CancelClubMessageFeature): Promise<CancelClubMessageFeatureResponse> {
        const viewer = await resolveMessageViewer(this.rbac, f)
        await loadVisibleMessage(this.prisma, viewer, f.messageId)
        const flipped = await this.prisma.clubMessage.updateMany({
            where: { id: f.messageId, status: 'SCHEDULED' },
            data: { status: 'CANCELLED' },
        })
        if (flipped.count === 0) {
            throw new BadRequestError({ message: 'Сообщение уже отправлено или отменено' })
        }
        const row = await this.prisma.clubMessage.findUniqueOrThrow({
            where: { id: f.messageId },
            select: { ...clubMessageSelect, contactId: true },
        })
        await dropMessageContact(this.prisma, this.callLists, {
            workspaceId: f.workspaceId,
            contactId: row.contactId,
        })
        await this.audit.record({
            action: 'message.cancel',
            targetType: 'clubMessage',
            targetId: row.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { segment: row.segment, isDirect: row.isDirect, sendAt: row.sendAt.toISOString() },
        })
        this.realtime.invalidateCoalesced(f.workspaceId, ['messages'])
        return loadClubMessageOutput(this.prisma, f.workspaceId, row)
    }
}
