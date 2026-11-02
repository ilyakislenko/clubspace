import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteWorkspaceEventFeature,
    DeleteWorkspaceEventFeatureResponse,
} from './delete-workspace-event.feature'

@Feature(DeleteWorkspaceEventFeature)
export class DeleteWorkspaceEventHandler
    implements
        IFeatureHandler<
            DeleteWorkspaceEventFeature,
            DeleteWorkspaceEventFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly rbac: RbacService,
        private readonly registrations: EventRegistrationService,
    ) {}

    async execute({
        workspaceId,
        eventId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: DeleteWorkspaceEventFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName,
            isSuperAdmin,
        })
        const managed = await this.rbac.managedDirectionIds(ctx)
        // Any coach edits events (unchanged); a direction manager is held to their directions (club-wide ones included).
        if (managed?.length) {
            const existing = await this.prisma.workspaceEvent.findFirst({
                where: { id: eventId, workspaceId },
                select: { directionId: true },
            })
            if (existing) {
                await this.rbac.assertCanManageDirection(
                    ctx,
                    existing.directionId,
                )
            }
        }
        // Refused while the event holds paid tickets: deleting it would take
        // the club's money out of the revenue (see deleteEvent).
        await this.registrations.deleteEvent(workspaceId, eventId)

        await this.audit.record({
            action: 'event.delete',
            targetType: 'event',
            targetId: eventId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {},
        })

        this.realtime.emitListDelta(workspaceId, 'events', 'delete', {
            id: eventId,
        })

        return { status: 'deleted' as const }
    }
}
