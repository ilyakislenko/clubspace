import { Feature, FeaturesBus, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { UsersService } from '../../domains/users/services/users.service'
import { defaultFeatureColumnsFor } from '../../domains/workspace/feature-flags'
import {
    appLinksHtml,
    buildAppLinks,
    buildJoinUrl,
} from '../../domains/workspace/invite-links'
import { formatJoinCode } from '../../domains/workspace/join-code'
import { ensureJoinCode } from '../../domains/workspace/join-code.store'
import { environment } from '../../environments/environment'
import { resolveWorkspaceKey } from '../../domains/workspace/workspace-key.store'
import { NotificationTypeEnum, PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { escapeHtml } from '../../shared/utils/escape-html'
import {
    SendNotificationFeature,
    SendNotificationFeatureResponse,
} from '../send-notification/send-notification.feature'
import {
    CreatePlatformWorkspaceFeature,
    CreatePlatformWorkspaceFeatureResponse,
} from './create-platform-workspace.feature'
import { normalizeEmail } from './platform-utils'
import { serializePlatformWorkspace } from './schemas'

@Feature(CreatePlatformWorkspaceFeature)
export class CreatePlatformWorkspaceHandler
    implements
        IFeatureHandler<
            CreatePlatformWorkspaceFeature,
            CreatePlatformWorkspaceFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly bus: FeaturesBus,
        private readonly users: UsersService,
    ) {}

    async execute(f: CreatePlatformWorkspaceFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const { name, type, timezone } = f.payload
        const ownerEmail = normalizeEmail(f.payload.ownerEmail)
        const key = await resolveWorkspaceKey(this.prisma, name, f.payload.key)

        // Roles are seeded at boot (BootstrapSeedService.setupRoles) and
        // lowercased on the way in. If it is missing the platform is not
        // initialised, and creating an owner with no role would leave them
        // unable to administer the club they just received.
        const adminRole = await this.prisma.role.findUnique({
            where: { name: 'admin' },
            select: { id: true },
        })
        if (!adminRole) {
            throw new BadRequestError({
                message:
                    'Роль «admin» отсутствует — платформа не до конца инициализирована',
            })
        }

        const existingOwner = await this.users.getUserByEmail({ email: ownerEmail })

        const result = await this.prisma.$transaction(async (tx) => {
            // No password: sign-in is email-OTP (see send-auth-code), so the
            // owner can request a code for this address straight away. Setting
            // a password here would only create a credential nobody was told.
            const owner =
                existingOwner ??
                (await tx.user.create({
                    data: {
                        email: ownerEmail,
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

            const workspace = await tx.workspace.create({
                data: {
                    key,
                    name,
                    type,
                    ownerId: owner.id,
                    isActive: true,
                    ...defaultFeatureColumnsFor(type),
                    ...(timezone ? { timezone } : {}),
                },
                select: {
                    id: true,
                    key: true,
                    name: true,
                    type: true,
                    isActive: true,
                    timezone: true,
                    createdAt: true,
                },
            })

            // The owner gets a membership row on purpose, and this is the
            // subtle bit. RbacService bypasses membership for the owner, so
            // permissions would work without it — but get-my-workspaces (how
            // BOTH the admin app and the mobile app discover workspaces) reads
            // memberships. Without this row the new owner signs in and sees an
            // empty list with no way into the club they were just given.
            await tx.workspaceMember.create({
                data: {
                    userId: owner.id,
                    workspaceId: workspace.id,
                    roleId: adminRole.id,
                    status: 'ACTIVE',
                },
            })

            return { workspace, owner }
        })

        // Recorded against the new club, so it also lands in that club's own
        // journal: its owner can see who created it, when, and that their
        // account was made for them rather than by them.
        await this.audit.record({
            action: 'workspace.create',
            targetType: 'workspace',
            targetId: result.workspace.id,
            workspaceId: result.workspace.id,
            actorId: f.invokerUserId,
            metadata: {
                key: result.workspace.key,
                name: result.workspace.name,
                type: result.workspace.type,
                ownerEmail,
                ownerCreated: existingOwner === null,
            },
        })

        // Never fails the creation: the club exists either way, and the
        // console tells the operator to pass the address on by hand.
        const ownerNotified = await this.notifyOwner(
            result.owner.id,
            result.workspace.id,
            result.workspace.name,
            ownerEmail,
        )

        return {
            workspace: serializePlatformWorkspace(
                result.workspace,
                result.owner,
                1,
            ),
            ownerCreated: existingOwner === null,
            ownerNotified,
        }
    }

    private async notifyOwner(
        ownerId: string,
        workspaceId: string,
        workspaceName: string,
        ownerEmail: string,
    ): Promise<boolean> {
        // No public admin address: there is no sign-in link to send.
        if (!environment.adminUrl) return false
        try {
            const code = await ensureJoinCode(this.prisma, workspaceId)
            const joinUrl = buildJoinUrl(environment.appUrl, code)
            const result = await this.bus.execute<
                SendNotificationFeature,
                SendNotificationFeatureResponse
            >(
                new SendNotificationFeature({
                    userId: ownerId,
                    topic: `Ваш клуб «${workspaceName}» в ClubSpace готов`,
                    message: {
                        htmlTemplateKey: 'workspace-owner-welcome',
                        data: {
                            workspaceName: escapeHtml(workspaceName),
                            ownerEmail: escapeHtml(ownerEmail),
                            signInUrl: escapeHtml(
                                `${environment.adminUrl}/sign-in?email=${encodeURIComponent(ownerEmail)}`,
                            ),
                            joinCodeDisplay: formatJoinCode(code),
                            // Pre-rendered: templates have no conditionals.
                            joinLinkHtml: joinUrl
                                ? ` · <a href="${escapeHtml(joinUrl)}">${escapeHtml(joinUrl)}</a>`
                                : '',
                            appLinksHtml: appLinksHtml(
                                buildAppLinks({
                                    appUrl: environment.appUrl ?? '',
                                    appStoreUrl: environment.appStoreUrl,
                                    playStoreUrl: environment.playStoreUrl,
                                    ruStoreUrl: environment.ruStoreUrl,
                                }),
                            ),
                        },
                    },
                    types: [NotificationTypeEnum.EMAIL],
                    forced: true,
                    metadata: { kind: 'workspace.ownerWelcome', workspaceId },
                }),
            )
            return result.success
        } catch {
            return false
        }
    }
}
