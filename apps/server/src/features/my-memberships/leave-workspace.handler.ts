import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
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
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
    }: LeaveWorkspaceFeature): Promise<LeaveWorkspaceFeatureResponse> {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
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
            throw new BadRequestError({
                message:
                    'Вы главный тренер группы в этом клубе. Попросите администратора назначить другого тренера, затем выйдите.',
            })
        }

        await this.prisma.$transaction((tx) =>
            purgeMembership(tx, {
                memberId: member.id,
                userId: invokerUserId,
                workspaceId,
                now: new Date(),
            }),
        )

        await this.audit.record({
            action: 'member.leave',
            targetType: 'member',
            targetId: invokerUserId,
            workspaceId,
            actorId: invokerUserId,
        })

        this.realtime.invalidate(workspaceId, ['members', 'freeze-requests'])
        // No longer a member: stop pushing this club's events to their sockets.
        this.realtime.leaveWorkspaceRoom([invokerUserId], workspaceId)

        return { status: 'left' as const }
    }
}
