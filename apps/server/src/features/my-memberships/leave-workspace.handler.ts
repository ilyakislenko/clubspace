import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { MemberAutopayAgreementsService } from '../../domains/autopay/member-autopay-agreements.service'
import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import { purgeMembership } from '../remove-workspace-member/purge-membership'
import {
    LeaveWorkspaceFeature,
    LeaveWorkspaceFeatureResponse,
} from './leave-workspace.feature'

// A member leaves a club on their own. Same cleanup as an admin removal; the
// same hand-over rule as deleting the account: the owner and the primary coach
// of a group must pass that role on first (a group can't point at a coach who
// is not in the club).
@Feature(LeaveWorkspaceFeature)
export class LeaveWorkspaceHandler
    implements IFeatureHandler<LeaveWorkspaceFeature, LeaveWorkspaceFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly eventRegistrations: EventRegistrationService,
        private readonly autopay: MemberAutopayAgreementsService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
    }: LeaveWorkspaceFeature): Promise<LeaveWorkspaceFeatureResponse> {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true, type: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }
        if (workspace.ownerId === invokerUserId) {
            throw new BadRequestError({
                message:
                    'Вы владелец этого клуба. Передайте клуб другому человеку в админ-панели, затем выйдите.',
            })
        }

        const member = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: { userId: invokerUserId, workspaceId },
            },
            select: { id: true },
        })
        if (!member) {
            throw new NotFoundError({ message: 'Вы не состоите в этом клубе' })
        }

        const coachedGroups = await this.prisma.group.count({
            where: { workspaceId, coachId: invokerUserId },
        })
        if (coachedGroups > 0) {
            const v = vocabularyForWorkspaceType(workspace.type)
            throw new BadRequestError({
                message: `Вы главный ${v.coach.nom} группы в этом клубе. Попросите администратора назначить другого ${v.coach.acc}, затем выйдите.`,
            })
        }

        const { freedEventIds } = await this.prisma.$transaction((tx) =>
            purgeMembership(tx, {
                memberId: member.id,
                userId: invokerUserId,
                workspaceId,
                now: new Date(),
            }),
        )
        await this.eventRegistrations.promoteFreed(workspaceId, freedEventIds)
        // Membership ended: autopay stops with it (token wiped, notice sent).
        await this.autopay.cancelForUser(workspaceId, invokerUserId, 'вы вышли из клуба')

        await this.audit.record({
            action: 'member.leave',
            targetType: 'member',
            targetId: invokerUserId,
            workspaceId,
            actorId: invokerUserId,
        })

        this.realtime.invalidate(workspaceId, ['members', 'freeze-requests', 'requests'])
        // No longer a member: stop pushing this club's events to their sockets.
        this.realtime.leaveWorkspaceRoom([invokerUserId], workspaceId)

        return { status: 'left' as const }
    }
}
