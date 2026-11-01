import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { UsersService } from '../../domains/users/services/users.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    NotFoundError,
    PlanLimitReachedError,
} from '../../shared/errors/shared.errors'
import { RolesEnum } from '../../shared/interfaces/shared.intefaces'
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
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: ImportMembersFeature) {
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
                          userId_workspaceId: {
                              userId: existing.id,
                              workspaceId,
                          },
                      },
                      select: { id: true, status: true },
                  })
                : null
            if (member?.status === 'ACTIVE') {
                skipped++
                continue
            }
            // Before the account is created, so a row over the limit leaves
            // nothing behind.
            if (capacity !== null && capacity <= 0) {
                limited++
                invalid.push({
                    email,
                    reason: `Лимит тарифа «${quota.planName}»: ${quota.max} участников`,
                })
                continue
            }

            let userId: string
            if (existing) {
                userId = existing.id
            } else {
                const created = await this.users.createUser({ email })
                userId = created.id
                // Names only for a brand-new user — never overwrite an
                // existing person's profile from an import row.
                const first = row.firstname?.trim() || null
                const last = row.lastname?.trim() || null
                if (first || last) {
                    await this.prisma.user.update({
                        where: { id: userId },
                        data: { firstname: first, lastname: last },
                    })
                }
            }

            if (member) {
                // Re-activate an INVITED/suspended row into a full member.
                await this.prisma.workspaceMember.update({
                    where: { id: member.id },
                    data: { status: 'ACTIVE', roleId: role.id },
                })

            } else {
                await this.prisma.workspaceMember.create({
                    data: {
                        status: 'ACTIVE',
                        workspace: { connect: { id: workspaceId } },
                        user: { connect: { id: userId } },
                        role: { connect: { id: role.id } },
                    },
                })
            }
            added++
            activated.push(userId)
            if (capacity !== null) capacity--
        }

        if (added === 0 && limited > 0) {
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
            metadata: { added, skipped, invalid: invalid.length, limited },
        })
        if (added > 0) {
            this.realtime.invalidate(workspaceId, ['members'])
            this.realtime.joinWorkspaceRoom(activated, workspaceId)
        }

        return { added, skipped, invalid }
    }
}
