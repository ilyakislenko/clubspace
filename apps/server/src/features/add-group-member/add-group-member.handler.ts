import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    AddGroupMemberFeature,
    AddGroupMemberFeatureResponse,
} from './add-group-member.feature'

@Feature(AddGroupMemberFeature)
export class AddGroupMemberHandler
    implements
        IFeatureHandler<
            AddGroupMemberFeature,
            AddGroupMemberFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        groupId,
        invokerUserId,
    }: AddGroupMemberFeature) {
        const [group, userMembership] = await Promise.all([
            this.prisma.group.findFirst({
                where: { id: groupId, workspaceId },
                select: { id: true },
            }),
            this.prisma.workspaceMember.findFirst({
                where: { userId: payload.userId, workspaceId },
                select: { id: true },
            }),
        ])

        if (!group) throw new NotFoundError({ message: 'Group not found' })
        if (!userMembership) {
            throw new NotFoundError({
                message: 'User is not a member of this workspace',
            })
        }

        // Idempotent — re-adding an existing member is a no-op rather than
        // a 409 error, so the UI can re-emit the request after a flaky tap
        // without having to handle the duplicate case.
        const entry = await this.prisma.groupMember.upsert({
            where: {
                groupId_userId: { groupId, userId: payload.userId },
            },
            update: {},
            create: { groupId, userId: payload.userId },
        })

        await this.audit.record({
            action: 'group.add_member',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { userId: payload.userId },
        })

        return {
            groupId: entry.groupId,
            userId: entry.userId,
            joinedAt: entry.joinedAt.toISOString(),
        }
    }
}
