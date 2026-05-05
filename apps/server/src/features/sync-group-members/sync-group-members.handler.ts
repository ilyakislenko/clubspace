import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    SyncGroupMembersFeature,
    SyncGroupMembersFeatureResponse,
} from './sync-group-members.feature'

@Feature(SyncGroupMembersFeature)
export class SyncGroupMembersHandler
    implements
        IFeatureHandler<
            SyncGroupMembersFeature,
            SyncGroupMembersFeatureResponse
        >
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
    }: SyncGroupMembersFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        const desiredIds = Array.from(new Set(payload.userIds))

        // Validate every desired user is a workspace member — prevents
        // attaching outsiders to a group via a hand-crafted payload.
        if (desiredIds.length > 0) {
            const valid = await this.prisma.workspaceMember.findMany({
                where: { workspaceId, userId: { in: desiredIds } },
                select: { userId: true },
            })
            const validSet = new Set(valid.map((m) => m.userId))
            const invalid = desiredIds.filter((id) => !validSet.has(id))
            if (invalid.length > 0) {
                throw new BadRequestError({
                    message: `Some students are not in this workspace: ${invalid.join(', ')}`,
                })
            }
        }

        // Diff current vs desired and apply add/remove in a single
        // transaction so a network blip can't leave the group in a
        // half-synced state (the previous flow did them sequentially
        // from the client).
        const current = await this.prisma.groupMember.findMany({
            where: { groupId },
            select: { userId: true },
        })
        const currentSet = new Set(current.map((m) => m.userId))
        const desiredSet = new Set(desiredIds)
        const toAdd = desiredIds.filter((id) => !currentSet.has(id))
        const toRemove = [...currentSet].filter((id) => !desiredSet.has(id))

        await this.prisma.$transaction([
            ...(toRemove.length > 0
                ? [
                      this.prisma.groupMember.deleteMany({
                          where: { groupId, userId: { in: toRemove } },
                      }),
                  ]
                : []),
            ...(toAdd.length > 0
                ? [
                      this.prisma.groupMember.createMany({
                          data: toAdd.map((userId) => ({ groupId, userId })),
                          skipDuplicates: true,
                      }),
                  ]
                : []),
        ])

        await this.audit.record({
            action: 'group.update',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                membersChanged: true,
                added: toAdd,
                removed: toRemove,
            },
        })

        return {
            groupId,
            addedCount: toAdd.length,
            removedCount: toRemove.length,
            memberCount: desiredIds.length,
        }
    }
}
