import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { normalizeEmail } from './platform-utils'
import { serializePlatformWorkspace } from './schemas'
import {
    UpdatePlatformWorkspaceFeature,
    UpdatePlatformWorkspaceFeatureResponse,
} from './update-platform-workspace.feature'

@Feature(UpdatePlatformWorkspaceFeature)
export class UpdatePlatformWorkspaceHandler
    implements
        IFeatureHandler<
            UpdatePlatformWorkspaceFeature,
            UpdatePlatformWorkspaceFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: UpdatePlatformWorkspaceFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const { name, type, timezone, isActive } = f.payload

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true, ownerId: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const transfer = f.payload.ownerEmail
            ? await this.resolveNewOwner(
                  normalizeEmail(f.payload.ownerEmail),
                  workspace.ownerId,
              )
            : null

        const updated = await this.prisma.$transaction(async (tx) => {
            let ownerId = workspace.ownerId

            if (transfer?.shouldTransfer) {
                const owner =
                    transfer.existing ??
                    (await tx.user.create({
                        data: {
                            email: transfer.email,
                            status: 'ACTIVE',
                            language: 'RU',
                        },
                        select: {
                            id: true,
                            email: true,
                            firstname: true,
                            lastname: true,
                        },
                    }))
                ownerId = owner.id

                // Same reason as on create: get-my-workspaces reads
                // memberships, so without a row the new owner cannot navigate
                // to the club they now own. Idempotent — they may already be a
                // member (promoting a coach to owner is the common case), in
                // which case leave their existing role alone.
                const membership = await tx.workspaceMember.findUnique({
                    where: {
                        userId_workspaceId: {
                            userId: owner.id,
                            workspaceId: f.workspaceId,
                        },
                    },
                    select: { id: true },
                })
                if (!membership) {
                    const adminRole = await tx.role.findUnique({
                        where: { name: 'admin' },
                        select: { id: true },
                    })
                    if (!adminRole) {
                        throw new BadRequestError({
                            message:
                                'Роль «admin» отсутствует — платформа не до конца инициализирована',
                        })
                    }
                    await tx.workspaceMember.create({
                        data: {
                            userId: owner.id,
                            workspaceId: f.workspaceId,
                            roleId: adminRole.id,
                            status: 'ACTIVE',
                        },
                    })
                }

                // The previous owner keeps whatever membership they had.
                // Stripping it here would silently cut a club's founder out of
                // their own club on what is meant to be a hand-over; demoting
                // them is the new owner's call, from the club's own admin.
            }

            return await tx.workspace.update({
                where: { id: f.workspaceId },
                data: {
                    ...(name !== undefined ? { name } : {}),
                    ...(type !== undefined ? { type } : {}),
                    ...(timezone !== undefined ? { timezone } : {}),
                    ...(isActive !== undefined ? { isActive } : {}),
                    ...(ownerId !== workspace.ownerId ? { ownerId } : {}),
                },
                select: {
                    id: true,
                    key: true,
                    name: true,
                    type: true,
                    isActive: true,
                    timezone: true,
                    ownerId: true,
                    createdAt: true,
                    _count: { select: { members: true } },
                },
            })
        })

        const owner = await this.prisma.user.findUnique({
            where: { id: updated.ownerId },
            select: { id: true, email: true, firstname: true, lastname: true },
        })

        return {
            workspace: serializePlatformWorkspace(updated, owner),
            ownerCreated: Boolean(
                transfer?.shouldTransfer && transfer.existing === null,
            ),
            ownerTransferred: Boolean(transfer?.shouldTransfer),
        }
    }

    private async resolveNewOwner(email: string, currentOwnerId: string) {
        const existing = await this.prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, firstname: true, lastname: true },
        })

        return {
            email,
            existing,
            // Re-submitting the current owner's address is a no-op rather than
            // an error — the console sends the whole form back on every save.
            shouldTransfer: existing?.id !== currentOwnerId,
        }
    }
}
