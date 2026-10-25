import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'

import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    type RoleName,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
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
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

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

        // The new owner's member role before the transfer (null = no row), so
        // the audit shows when the hand-over also raised their role.
        let previousRole: string | null = null

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
                // member (promoting a coach to owner is the common case). The
                // auth guard reads the role from the member row first, so an
                // owner whose row says `coach` would get 403 on every admin
                // route of their own club: anything below admin level is
                // raised to `admin`; an existing head_coach is left alone.
                const membership = await tx.workspaceMember.findUnique({
                    where: {
                        userId_workspaceId: {
                            userId: owner.id,
                            workspaceId: f.workspaceId,
                        },
                    },
                    select: { id: true, role: { select: { name: true } } },
                })
                previousRole = membership?.role.name ?? null
                const isAdminLevel =
                    !!membership &&
                    WORKSPACE_ADMINS.includes(membership.role.name as RoleName)
                if (!isAdminLevel) {
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
                    if (membership) {
                        await tx.workspaceMember.update({
                            where: { id: membership.id },
                            data: { roleId: adminRole.id },
                        })
                    } else {
                        await tx.workspaceMember.create({
                            data: {
                                userId: owner.id,
                                workspaceId: f.workspaceId,
                                roleId: adminRole.id,
                                status: 'ACTIVE',
                            },
                        })
                    }
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

        // Only the fields that were actually sent, so the journal says what
        // changed rather than restating the whole row.
        const changed = Object.fromEntries(
            Object.entries({ name, type, timezone, isActive }).filter(
                ([, v]) => v !== undefined,
            ),
        )
        if (Object.keys(changed).length > 0) {
            await this.audit.record({
                action: 'workspace.update',
                targetType: 'workspace',
                targetId: f.workspaceId,
                workspaceId: f.workspaceId,
                actorId: f.invokerUserId,
                metadata: changed,
            })
        }

        // A hand-over is its own event, not a field edit: it changes who
        // controls the club, and it is the thing you go looking for later.
        if (transfer?.shouldTransfer) {
            await this.audit.record({
                action: 'workspace.transferOwner',
                targetType: 'workspace',
                targetId: f.workspaceId,
                workspaceId: f.workspaceId,
                actorId: f.invokerUserId,
                metadata: {
                    fromOwnerId: workspace.ownerId,
                    toOwnerId: updated.ownerId,
                    toOwnerEmail: transfer.email,
                    ownerAccountCreated: transfer.existing === null,
                    previousRole,
                },
            })
        }

        return {
            workspace: serializePlatformWorkspace(updated, owner),
            ownerCreated: Boolean(
                transfer?.shouldTransfer && transfer.existing === null,
            ),
            ownerTransferred: Boolean(transfer?.shouldTransfer),
        }
    }

    private async resolveNewOwner(email: string, currentOwnerId: string) {
        const existing = await this.prisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
            orderBy: { createdAt: 'asc' },
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
