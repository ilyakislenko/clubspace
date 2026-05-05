import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    CreateGroupFeature,
    CreateGroupFeatureResponse,
} from './create-group.feature'

@Feature(CreateGroupFeature)
export class CreateGroupHandler
    implements IFeatureHandler<CreateGroupFeature, CreateGroupFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: CreateGroupFeature) {
        // Coaches can only create groups they themselves coach. Admin and
        // head_coach can create groups under any coach. Enforced after
        // RoleGuard already accepted the request, so unauthorised users
        // never reach this point.
        if (
            !isSuperAdmin &&
            invokerRoleName === 'coach' &&
            payload.coachId !== invokerUserId
        ) {
            throw new ForbiddenError({
                message: 'Coach can only create groups they personally lead',
            })
        }
        // Validate that gym + coach + every member belong to this workspace.
        // Without this check a malicious request could attach a coach from
        // another club, leaking who they are when the group is rendered.
        const [gym, coachMembership] = await Promise.all([
            this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            }),
            this.prisma.workspaceMember.findFirst({
                where: { userId: payload.coachId, workspaceId },
                select: { id: true },
            }),
        ])

        if (!gym) throw new NotFoundError({ message: 'Gym not found' })
        if (!coachMembership) {
            throw new BadRequestError({
                message: 'Coach must be a member of the workspace',
            })
        }

        const memberIds = payload.memberIds ?? []
        if (memberIds.length > 0) {
            const validMembers = await this.prisma.workspaceMember.findMany({
                where: { workspaceId, userId: { in: memberIds } },
                select: { userId: true },
            })
            const validIds = new Set(validMembers.map((m) => m.userId))
            const invalid = memberIds.filter((id) => !validIds.has(id))
            if (invalid.length > 0) {
                throw new BadRequestError({
                    message: `Some students are not in this workspace: ${invalid.join(', ')}`,
                })
            }
        }

        const group = await this.prisma.group.create({
            data: {
                workspaceId,
                name: payload.name,
                gymId: payload.gymId,
                coachId: payload.coachId,
                scheduleText: payload.scheduleText ?? null,
                members: {
                    create: memberIds.map((userId) => ({ userId })),
                },
            },
        })

        await this.audit.record({
            action: 'group.create',
            targetType: 'group',
            targetId: group.id,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                name: group.name,
                gymId: group.gymId,
                coachId: group.coachId,
                memberCount: memberIds.length,
            },
        })

        return {
            id: group.id,
            name: group.name,
            gymId: group.gymId,
            coachId: group.coachId,
        }
    }
}
