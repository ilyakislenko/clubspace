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

        // Validate + snapshot + diff + apply all happen inside one
        // interactive transaction. Doing the validation outside leaves
        // a TOCTOU window where a concurrent remove-workspace-member
        // could pull one of the just-validated users from the workspace
        // before the create lands.
        const { toAdd, toRemove } = await this.prisma.$transaction(
            async (tx) => {
                // Coach can't double as student of their own group.
                const group = await tx.group.findUnique({
                    where: { id: groupId },
                    select: { coachId: true },
                })
                if (group && desiredIds.includes(group.coachId)) {
                    throw new BadRequestError({
                        message:
                            'Тренера нельзя добавить учеником в его же группу',
                    })
                }
                if (desiredIds.length > 0) {
                    const coaches = await tx.groupCoach.findMany({
                        where: { groupId, userId: { in: desiredIds } },
                        select: { userId: true },
                    })
                    if (coaches.length > 0) {
                        throw new BadRequestError({
                            message: 'Тренер группы не может быть её учеником',
                        })
                    }
                    const valid = await tx.workspaceMember.findMany({
                        where: { workspaceId, userId: { in: desiredIds } },
                        select: { userId: true },
                    })
                    const validSet = new Set(valid.map((m) => m.userId))
                    const invalid = desiredIds.filter(
                        (id) => !validSet.has(id),
                    )
                    if (invalid.length > 0) {
                        throw new BadRequestError({
                            message: `Некоторые ученики не состоят в клубе: ${invalid.join(', ')}`,
                        })
                    }
                }

                // Snapshot scoped via `group: { workspaceId }` so we never
                // touch rows from a group with the same id in another
                // workspace (UUIDs make that improbable, but the explicit
                // scope matches what every other groupMember query does).
                const current = await tx.groupMember.findMany({
                    where: { groupId, group: { workspaceId } },
                    select: { userId: true },
                })
                const currentSet = new Set(current.map((m) => m.userId))
                const desiredSet = new Set(desiredIds)
                const toAdd = desiredIds.filter((id) => !currentSet.has(id))
                const toRemove = [...currentSet].filter(
                    (id) => !desiredSet.has(id),
                )

                if (toRemove.length > 0) {
                    await tx.groupMember.deleteMany({
                        where: { groupId, userId: { in: toRemove } },
                    })
                }
                if (toAdd.length > 0) {
                    await tx.groupMember.createMany({
                        data: toAdd.map((userId) => ({ groupId, userId })),
                        skipDuplicates: true,
                    })
                    // New members are no longer guests of this group.
                    await tx.dropInBooking.deleteMany({
                        where: { groupId, userId: { in: toAdd } },
                    })
                }
                return { toAdd, toRemove }
            },
        )

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
