import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrgAdmin, OrgRbacService } from '../../domains/organizations/org-access'
import { OrgNotifierService } from '../../domains/organizations/org-notifier.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { normalizeEmail } from '../platform/platform-utils'
import { AddOrgMemberFeature, AddOrgMemberFeatureResponse } from './org-members.feature'
import { ORG_MEMBER_SELECT, serializeOrgMember } from './schemas'

export const LAST_ORG_ADMIN_MESSAGE =
    'В федерации должен остаться хотя бы один администратор'

export const DEMO_ORG_MEMBER_MESSAGE =
    'В демо-федерацию можно добавить только демо-аккаунт'

// Adds org staff by e-mail, creating the account when missing (the way
// invite-workspace-member does — sign-in is e-mail OTP), or changes the role
// of a teammate. Org staff never get a WorkspaceMember row anywhere.
@Feature(AddOrgMemberFeature)
export class AddOrgMemberHandler
    implements IFeatureHandler<AddOrgMemberFeature, AddOrgMemberFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
        private readonly notifier: OrgNotifierService,
    ) {}

    async execute({ payload, organizationId, invokerUserId, isSuperAdmin }: AddOrgMemberFeature) {
        await assertOrgAdmin(
            this.orgRbac,
            { userId: invokerUserId, organizationId, isSuperAdmin },
            'Команду федерации меняет администратор федерации',
        )
        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { id: true, name: true, isDemo: true },
        })
        if (!org) throw new NotFoundError({ message: 'Федерация не найдена' })

        const email = normalizeEmail(payload.email)
        const found = await this.prisma.user.findUnique({
            where: { email },
            select: { id: true, status: true, isDemo: true },
        })
        if (found && found.status !== 'ACTIVE') {
            throw new BadRequestError({ message: 'Этот аккаунт заблокирован или удалён' })
        }
        // The demo federation is public (fixed demo code): it may take only an
        // existing demo account — no account created, no e-mail to a stranger.
        if (org.isDemo && !found?.isDemo) {
            throw new BadRequestError({ message: DEMO_ORG_MEMBER_MESSAGE })
        }

        const outcome = await this.prisma.$transaction(async (tx) => {
            const userId =
                found?.id ??
                (
                    await tx.user.create({
                        data: { email, status: 'ACTIVE', language: 'RU' },
                        select: { id: true },
                    })
                ).id
            const existing = await tx.organizationMember.findUnique({
                where: { organizationId_userId: { organizationId, userId } },
                select: { id: true, role: true },
            })
            if (!existing) {
                await tx.organizationMember.create({
                    data: { organizationId, userId, role: payload.role, invitedById: invokerUserId },
                })
                return { userId, kind: 'added' as const }
            }
            if (existing.role === payload.role) return { userId, kind: 'unchanged' as const }
            if (existing.role === 'ORG_ADMIN') {
                const admins = await tx.organizationMember.count({
                    where: { organizationId, role: 'ORG_ADMIN' },
                })
                if (admins <= 1) throw new BadRequestError({ message: LAST_ORG_ADMIN_MESSAGE })
            }
            await tx.organizationMember.update({
                where: { id: existing.id },
                data: { role: payload.role },
            })
            return { userId, kind: 'roleChanged' as const }
        })

        if (outcome.kind === 'added' && !org.isDemo) {
            await this.notifier.notifyMemberAdded({
                userId: outcome.userId,
                organization: org,
                role: payload.role,
            })
        }
        if (outcome.kind !== 'unchanged') {
            await this.audit.record({
                action: 'org.memberAdd',
                targetType: 'organizationMember',
                targetId: outcome.userId,
                organizationId,
                workspaceId: null,
                actorId: invokerUserId,
                metadata: {
                    userId: outcome.userId,
                    role: payload.role,
                    accountCreated: !found,
                    roleChanged: outcome.kind === 'roleChanged',
                },
            })
        }

        const member = await this.prisma.organizationMember.findUniqueOrThrow({
            where: { organizationId_userId: { organizationId, userId: outcome.userId } },
            select: ORG_MEMBER_SELECT,
        })
        return serializeOrgMember(member)
    }
}
