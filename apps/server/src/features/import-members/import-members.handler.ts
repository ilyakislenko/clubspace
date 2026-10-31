import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { UsersService } from '../../domains/users/services/users.service'
import { WorkspaceInvitationService } from '../../domains/workspace/services/workspace-invitation.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    NotFoundError,
    PlanLimitReachedError,
} from '../../shared/errors/shared.errors'
import { RolesEnum } from '../../shared/interfaces/shared.intefaces'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ImportMembersFeature,
    ImportMembersFeatureResponse,
} from './import-members.feature'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

@Feature(ImportMembersFeature)
export class ImportMembersHandler
    implements
        IFeatureHandler<ImportMembersFeature, ImportMembersFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly users: UsersService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly billing: PlatformBillingService,
        private readonly rbac: RbacService,
        private readonly invitations: WorkspaceInvitationService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: ImportMembersFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Импортировать участников может только администратор клуба',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, name: true, ownerId: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const role = await this.prisma.role.findUnique({
            where: { name: RolesEnum.USER.toLowerCase() },
            select: { id: true },
        })
        if (!role) {
            throw new NotFoundError({ message: 'Базовая роль участника не найдена (клуб не до конца инициализирован)' })
        }

        // The plan's member limit is honoured row by row: the import adds
        // what fits and reports the rest. Nothing fitting at all is a typed
        // PLAN_LIMIT_REACHED, like a single add.
        const quota = await this.billing.remaining(workspaceId, 'members')
        let capacity = quota.remaining
        let limited = 0

        let added = 0
        const activated: string[] = []
        let invited = 0
        let skipped = 0
        const invalid: { email: string; reason: string }[] = []
        const seen = new Set<string>()

        for (const row of payload.members) {
            const email = row.email.toLowerCase().trim()
            if (!EMAIL_RE.test(email)) {
                invalid.push({ email: row.email, reason: 'Некорректный email' })
                continue
            }
            if (seen.has(email)) {
                invalid.push({ email, reason: 'Дубликат в файле' })
                continue
            }
            seen.add(email)

            const existing = await this.users.getUserByEmail({ email })
            const member = existing
                ? await this.prisma.workspaceMember.findUnique({
                      where: {
                          userId_workspaceId: { userId: existing.id, workspaceId },
                      },
                      select: { id: true, status: true },
                  })
                : null
            if (existing) {
                if (existing.status === 'BLOCKED' || existing.status === 'DELETED') {
                    invalid.push({ email, reason: 'Аккаунт заблокирован' })
                    continue
                }
                if (existing.id === workspace.ownerId || member?.status === 'ACTIVE') {
                    skipped++
                    continue
                }
                if (member?.status !== 'INVITED') {
                    // Anyone else with an account gets an offer to accept in
                    // the app (security M8); it takes no seat until accepted,
                    // and accepting checks the plan limit. The import sends no
                    // e-mails; the offer arrives as an in-app notification.
                    await this.invitations.invite({
                        workspace,
                        user: { id: existing.id, email },
                        roleName: 'user',
                        groupId: null,
                        invitedById: invokerUserId,
                        sendEmail: false,
                    })
                    invited++
                    continue
                }
            }
            // Only rows that become members take a seat. Checked before an
            // account is created, so a row over the limit leaves nothing behind.
            if (capacity !== null && capacity <= 0) {
                limited++
                invalid.push({
                    email,
                    reason: `Лимит тарифа «${quota.planName}»: ${quota.max} участников`,
                })
                continue
            }

            if (existing && member) {
                // They applied to this club themselves (INVITED): admit them.
                await this.prisma.workspaceMember.update({
                    where: { id: member.id },
                    data: { status: 'ACTIVE' },
                })
                activated.push(existing.id)
            } else {
                const created = await this.users.createUser({ email })
                // Names only for a brand-new user — never overwrite an
                // existing person's profile from an import row.
                const first = row.firstname?.trim() || null
                const last = row.lastname?.trim() || null
                if (first || last) {
                    await this.prisma.user.update({
                        where: { id: created.id },
                        data: { firstname: first, lastname: last },
                    })
                }
                await this.prisma.workspaceMember.create({
                    data: {
                        status: 'ACTIVE',
                        workspace: { connect: { id: workspaceId } },
                        user: { connect: { id: created.id } },
                        role: { connect: { id: role.id } },
                    },
                })
                activated.push(created.id)
            }
            added++
            if (capacity !== null) capacity--
        }

        if (added === 0 && invited === 0 && limited > 0) {
            throw new PlanLimitReachedError({
                limit: 'members',
                max: quota.max ?? 0,
                used: quota.used,
                planName: quota.planName,
            })
        }

        await this.audit.record({
            action: 'member.import',
            targetType: 'workspace',
            targetId: workspaceId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { added, invited, skipped, invalid: invalid.length, limited },
        })
        if (added > 0) {
            this.realtime.invalidate(workspaceId, ['members'])
            this.realtime.joinWorkspaceRoom(activated, workspaceId)
        }

        return { added, invited, skipped, invalid }
    }
}
