import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
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
        const { toAdd, toRemove, memberCount } = await this.prisma.$transaction(
            async (tx) => {
                // Snapshot scoped via `group: { workspaceId }` so we never
                // touch rows from a group with the same id in another
                // workspace (UUIDs make that improbable, but the explicit
                // scope matches what every other groupMember query does).
                const current = await tx.groupMember.findMany({
                    where: { groupId, group: { workspaceId } },
                    select: { userId: true },
                })
                const currentSet = new Set(current.map((m) => m.userId))

                // A coach (primary or assistant) can't double as a student of
                // their own group. A coach who is ALREADY a member (a row from
                // before this rule) is cleaned out of the roster instead of
                // failing the whole sync; adding a new one is refused by name.
                const group = await tx.group.findUnique({
                    where: { id: groupId },
                    select: { coachId: true },
                })
                const coachRows = await tx.groupCoach.findMany({
                    where: { groupId },
                    select: { userId: true },
                })
                const coachIds = new Set(coachRows.map((c) => c.userId))
                if (group) coachIds.add(group.coachId)
                const rejected = desiredIds.filter(
                    (id) => coachIds.has(id) && !currentSet.has(id),
                )
                if (rejected.length > 0) {
                    const users = await tx.user.findMany({
                        where: { id: { in: rejected } },
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            email: true,
                        },
                    })
                    throw new BadRequestError({
                        message: `Тренера нельзя добавить учеником в его же группу: ${users.map(displayName).join(', ')}`,
                    })
                }
                const desired = desiredIds.filter((id) => !coachIds.has(id))

                if (desired.length > 0) {
                    const valid = await tx.workspaceMember.findMany({
                        where: { workspaceId, userId: { in: desired } },
                        select: { userId: true },
                    })
                    const validSet = new Set(valid.map((m) => m.userId))
                    const invalid = desired.filter(
                        (id) => !validSet.has(id),
                    )
                    if (invalid.length > 0) {
                        throw new BadRequestError({
                            message: `Некоторые ученики не состоят в клубе: ${invalid.join(', ')}`,
                        })
                    }
                }

                const desiredSet = new Set(desired)
                const toAdd = desired.filter((id) => !currentSet.has(id))
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
                return { toAdd, toRemove, memberCount: desired.length }
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
            memberCount,
        }
    }
}
