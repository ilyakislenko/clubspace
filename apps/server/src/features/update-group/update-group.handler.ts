import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    UpdateGroupFeature,
    UpdateGroupFeatureResponse,
} from './update-group.feature'

@Feature(UpdateGroupFeature)
export class UpdateGroupHandler
    implements IFeatureHandler<UpdateGroupFeature, UpdateGroupFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        groupId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: UpdateGroupFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)
        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId },
            select: { id: true, name: true, gymId: true, coachId: true },
        })

        if (!group) {
            throw new NotFoundError({ message: 'Group not found' })
        }

        if (payload.gymId && payload.gymId !== group.gymId) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Gym not found' })
        }
        if (payload.coachId && payload.coachId !== group.coachId) {
            const [coach, workspace] = await Promise.all([
                this.prisma.workspaceMember.findFirst({
                    where: { userId: payload.coachId, workspaceId },
                    include: { role: { select: { name: true } } },
                }),
                this.prisma.workspace.findUnique({
                    where: { id: workspaceId },
                    select: { ownerId: true },
                }),
            ])
            if (!coach) {
                throw new NotFoundError({
                    message: 'New coach must be a workspace member',
                })
            }
            const COACH_CAPABLE = ['admin', 'head_coach', 'coach']
            const isOwner = workspace?.ownerId === payload.coachId
            if (
                !isOwner &&
                !COACH_CAPABLE.includes(coach.role.name)
            ) {
                throw new BadRequestError({
                    message:
                        'Selected user does not have a coaching role — promote them first',
                })
            }
        }

        const updated = await this.prisma.group.update({
            where: { id: groupId },
            data: {
                ...(payload.name !== undefined ? { name: payload.name } : {}),
                ...(payload.gymId !== undefined ? { gymId: payload.gymId } : {}),
                ...(payload.coachId !== undefined
                    ? { coachId: payload.coachId }
                    : {}),
                ...(payload.scheduleText !== undefined
                    ? { scheduleText: payload.scheduleText }
                    : {}),
            },
        })

        await this.audit.record({
            action: 'group.update',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                changes: payload,
            },
        })

        return {
            id: updated.id,
            name: updated.name,
            gymId: updated.gymId,
            coachId: updated.coachId,
            scheduleText: updated.scheduleText,
        }
    }
}
