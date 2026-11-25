import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { ClubMessageDeliveryService } from '../../domains/messages/deliver'
import { assertWithinLimits, loadDayCounts, lockClubMessages } from '../../domains/messages/limits'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { narrowCallList } from '../../domains/retention/call-list'
import { CallListCacheService } from '../../domains/retention/call-list-cache.service'
import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
import { type Compose, prepareCompose } from './compose'
import { clubMessageSelect, loadClubMessageOutput } from './schemas'
import {
    SendClubMessageFeature,
    type SendClubMessageFeatureResponse,
} from './send-club-message.feature'

// «Написать» (docs/design/2026-11-26-broadcast-and-direct-messages.md §4.2):
// stored as SCHEDULED; sent inline when its time is now (the response carries
// the counters), else by the minute dispatcher.
@Feature(SendClubMessageFeature)
export class SendClubMessageHandler
    implements IFeatureHandler<SendClubMessageFeature, SendClubMessageFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly delivery: ClubMessageDeliveryService,
        private readonly callLists: CallListCacheService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: SendClubMessageFeature): Promise<SendClubMessageFeatureResponse> {
        const now = new Date()
        const c = await prepareCompose(this.prisma, this.rbac, f, now)
        if (f.payload.logContact) await this.assertOnCallList(c)

        const author = await this.prisma.user.findUnique({
            where: { id: f.invokerUserId },
            select: { firstname: true, lastname: true, email: true },
        })
        // As LogAtRiskContactHandler: the server snapshots the signals.
        const [risk] = f.payload.logContact
            ? await loadWorkspaceRisk(this.prisma, {
                  workspaceId: f.workspaceId,
                  now,
                  userIds: [c.target.memberIds[0]],
              })
            : []
        // The day's limits and the insert under the club's lock: two parallel
        // sends can't both pass on the same count.
        const created = await this.prisma.$transaction(async (tx) => {
            await lockClubMessages(tx, f.workspaceId)
            assertWithinLimits(
                await loadDayCounts(tx, {
                    workspaceId: f.workspaceId,
                    senderId: f.invokerUserId,
                    sendAt: c.sendAt,
                    now,
                    timezone: c.workspace.timezone,
                }),
                { isDirect: c.isDirect, urgent: c.urgent, senderIsLead: c.isLead },
            )
            // «Написать» from «Кому позвонить» counts as «Связались» at once;
            // the message keeps the contact so cancelling it takes it back.
            const contact = f.payload.logContact
                ? await tx.memberRetentionContact.create({
                      data: {
                          workspaceId: f.workspaceId,
                          userId: c.target.memberIds[0],
                          contactedById: f.invokerUserId,
                          reason: risk?.risk.reason ?? null,
                          signals: risk?.risk.signals ?? [],
                          note: `Сообщение: ${f.payload.title}`.slice(0, 500),
                      },
                      select: { id: true },
                  })
                : null
            return tx.clubMessage.create({
                data: {
                    workspaceId: f.workspaceId,
                    authorId: f.invokerUserId,
                    authorName: (author ? displayName(author) : 'Клуб').slice(0, 255),
                    title: f.payload.title,
                    body: f.payload.body,
                    segment: c.target.segment,
                    directionId: c.target.directionId,
                    groupIds: c.target.groupIds,
                    memberIds: c.target.memberIds,
                    isDirect: c.isDirect,
                    isService: c.isService,
                    urgent: c.urgent,
                    withEmail: c.withEmail,
                    contactId: contact?.id ?? null,
                    sendAt: c.sendAt,
                },
                select: { id: true, segment: true, sendAt: true },
            })
        })
        // The call list drops the member on every surface.
        if (f.payload.logContact) await this.callLists.invalidate(f.workspaceId)
        // Audited as written, before delivery: a failure while sending still
        // leaves the record (recipients are on the message, not here).
        await this.audit.record({
            action: 'message.send',
            targetType: 'clubMessage',
            targetId: created.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                segment: created.segment,
                isDirect: c.isDirect,
                isService: c.isService,
                urgent: c.urgent,
                withEmail: c.withEmail,
                sendAt: created.sendAt.toISOString(),
            },
        })

        // Due now: sent after the commit. Should the request die before the
        // delivery claims it, the message is SCHEDULED and due: the minute
        // dispatcher sends it.
        if (c.sendAt <= now) {
            await this.delivery.deliver(created.id, now, {
                scope: c.scope,
                callList: () => this.callLists.get(f.workspaceId),
            })
        } else {
            this.realtime.invalidateCoalesced(f.workspaceId, ['messages'])
        }

        const row = await this.prisma.clubMessage.findUniqueOrThrow({
            where: { id: created.id },
            select: clubMessageSelect,
        })
        return loadClubMessageOutput(this.prisma, f.workspaceId, row)
    }

    // «Написать сообщение» from «Кому позвонить» counts as «Связались» only
    // for a direct message to someone still to call on the sender's list.
    private async assertOnCallList(c: Compose): Promise<void> {
        if (!c.isDirect) {
            throw new BadRequestError({
                message: 'Связь засчитывается только за личное сообщение',
            })
        }
        const list = await this.callLists.get(c.workspace.id)
        const entries = narrowCallList(
            list.entries,
            c.scope.groupIds === null ? null : new Set(c.scope.groupIds),
        )
        const userId = c.target.memberIds[0]
        if (!entries.some((e) => e.userId === userId && !e.snoozed)) {
            throw new BadRequestError({ message: 'Этого ученика нет в списке «Кому позвонить»' })
        }
    }
}
