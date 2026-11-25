import { Feature, IFeatureHandler } from '@shelfjs/features'

import { formatLocalDateTimeRu } from '../../../features/attendance/attendance-utils'
import { NotificationProducerService } from '../../../domains/notifications/services/notification-producer.service'
import { bookedCounts, bookOrgEvent } from '../../../domains/organizations/org-events'
import { RealtimeEmitter } from '../../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { RbacService } from '../../../shared/services/rbac.service'
import { isClubStaff, loadVisibleOrgEvent } from './club-org-events'
import {
    RegisterForOrgEventFeature,
    RegisterForOrgEventFeatureResponse,
} from './register-for-org-event.feature'

// Free registration for a federation event through this club. Oneself (a
// guardian for the child), or a coach for a student of their own groups —
// only one who consented to the federation (409 ORG_CONSENT_REQUIRED). The
// club must be ACTIVE in the org; a members' event needs the club's
// «События федерации» switch, a coaches' one is for the club's staff only.
@Feature(RegisterForOrgEventFeature)
export class RegisterForOrgEventHandler
    implements
        IFeatureHandler<RegisterForOrgEventFeature, RegisterForOrgEventFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: RegisterForOrgEventFeature) {
        const now = new Date()
        const targetId = f.payload.userId ?? f.invokerUserId
        const byCoach = targetId !== f.invokerUserId
        const staff = await isClubStaff(
            this.prisma,
            f.workspaceId,
            f.invokerUserId,
            f.roleName,
        )
        const event = await loadVisibleOrgEvent(this.prisma, {
            workspaceId: f.workspaceId,
            eventId: f.eventId,
            staff,
            now,
        })
        if (byCoach) {
            // Throws for anyone below coach; then the student must be in a
            // group the coach may write (admin scope: any group of the club).
            const ctx = await this.rbac.resolveCoachScope({
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            })
            await this.rbac.assertCanWriteMember(ctx, targetId)
            if (event.audience === 'STAFF') {
                throw new BadRequestError({
                    message: 'Это событие для тренеров — учеников на него не записывают',
                })
            }
            const member = await this.prisma.workspaceMember.findFirst({
                where: { workspaceId: f.workspaceId, userId: targetId, status: 'ACTIVE' },
                select: { id: true },
            })
            if (!member) throw new NotFoundError({ message: 'Ученик не найден' })
        }

        const { registration, created } = await bookOrgEvent(this.prisma, {
            event,
            workspaceId: f.workspaceId,
            userId: targetId,
            bookedById: f.guardianId ?? f.invokerUserId,
            now,
        })
        this.realtime.invalidate(f.workspaceId, ['organizations'])
        if (byCoach && created) {
            await this.notifications.notifyUser({
                userId: targetId,
                kind: 'org_event.registered_by_club',
                refId: `${registration.id}:${registration.updatedAt.getTime()}`,
                topic: 'Запись на событие федерации',
                message: `${event.title} · ${formatLocalDateTimeRu(event.startAt, event.timezone)}`,
                workspaceId: f.workspaceId,
                metadata: {
                    organizationId: event.organizationId,
                    eventId: event.id,
                    registrationId: registration.id,
                },
            })
        }
        const counts = await bookedCounts(this.prisma, [event.id])
        return {
            id: registration.id,
            eventId: event.id,
            status: registration.status,
            bookedCount: counts.get(event.id) ?? 0,
        }
    }
}
