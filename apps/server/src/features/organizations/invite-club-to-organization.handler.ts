import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { findClubByJoinCode, loadOrgClubLink } from '../../domains/organizations/club-links'
import { assertOrgAdmin, OrgRbacService } from '../../domains/organizations/org-access'
import { OrgNotifierService } from '../../domains/organizations/org-notifier.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { ConflictError, NotFoundError } from '../../shared/errors/shared.errors'
import {
    InviteClubToOrganizationFeature,
    InviteClubToOrganizationFeatureResponse,
} from './invite-club-to-organization.feature'
import { serializeOrgClubRow } from './schemas'

// The sharing a fresh invitation proposes (design §1): money off, the rest on.
// A re-invite starts from these again — joining is a new decision.
const DEFAULT_SHARING = {
    shareRegistry: true,
    shareMrr: false,
    shareRevenue30d: false,
    allowMemberAnnouncements: true,
    allowMemberEvents: true,
} as const

const isP2002 = (e: unknown): boolean => (e as { code?: string })?.code === 'P2002'

// Invites a club by its join code. Nothing is shared until the club's owner
// accepts in «Настройки → Федерация».
@Feature(InviteClubToOrganizationFeature)
export class InviteClubToOrganizationHandler
    implements
        IFeatureHandler<InviteClubToOrganizationFeature, InviteClubToOrganizationFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
        private readonly notifier: OrgNotifierService,
        private readonly realtime: RealtimeEmitter,
        private readonly files: FilesService,
    ) {}

    async execute({ payload, organizationId, invokerUserId, isSuperAdmin }: InviteClubToOrganizationFeature) {
        await assertOrgAdmin(
            this.orgRbac,
            { userId: invokerUserId, organizationId, isSuperAdmin },
            'Приглашать клубы может администратор федерации',
        )
        const [org, club] = await Promise.all([
            this.prisma.organization.findUnique({
                where: { id: organizationId },
                select: { id: true, name: true, isDemo: true },
            }),
            findClubByJoinCode(this.prisma, payload.joinCode),
        ])
        if (!org) throw new NotFoundError({ message: 'Федерация не найдена' })
        // The demo federation is opened by anyone with the public demo code: it
        // reaches demo clubs only, and a real club answers like an unknown code
        // (no invitation, no notice to a real owner).
        if (!club || (org.isDemo && !club.isDemo)) {
            throw new NotFoundError({ message: 'Клуб с таким кодом не найден' })
        }

        const existing = await this.prisma.organizationClub.findUnique({
            where: {
                organizationId_workspaceId: { organizationId, workspaceId: club.workspaceId },
            },
            select: { id: true, status: true },
        })
        if (existing?.status === 'ACTIVE') {
            throw new ConflictError({ message: `Клуб «${club.name}» уже в федерации` })
        }
        if (existing?.status === 'INVITED') {
            throw new ConflictError({ message: `Клубу «${club.name}» уже отправлено приглашение` })
        }

        const invitedAt = new Date()
        const invite = {
            status: 'INVITED' as const,
            invitedById: invokerUserId,
            invitedAt,
            decidedById: null,
            decidedAt: null,
            ...DEFAULT_SHARING,
        }
        let linkId: string
        if (existing) {
            // A declined, departed or removed club: the row is reused. The
            // status guard makes a concurrent second invite a no-op.
            const { count } = await this.prisma.organizationClub.updateMany({
                where: { id: existing.id, status: { in: ['DECLINED', 'LEFT', 'REMOVED'] } },
                data: invite,
            })
            if (count === 0) {
                throw new ConflictError({ message: `Клубу «${club.name}» уже отправлено приглашение` })
            }
            linkId = existing.id
        } else {
            try {
                linkId = (
                    await this.prisma.organizationClub.create({
                        data: { organizationId, workspaceId: club.workspaceId, ...invite },
                        select: { id: true },
                    })
                ).id
            } catch (e) {
                if (!isP2002(e)) throw e
                throw new ConflictError({ message: `Клубу «${club.name}» уже отправлено приглашение` })
            }
        }

        await this.notifier.notifyClubInvited({
            linkId,
            invitedAt,
            organization: org,
            club: { workspaceId: club.workspaceId, name: club.name, ownerId: club.ownerId },
        })
        await this.audit.record({
            action: 'org.inviteClub',
            targetType: 'organizationClub',
            targetId: linkId,
            organizationId,
            workspaceId: null,
            actorId: invokerUserId,
            metadata: { clubName: club.name, reinvite: Boolean(existing) },
        })
        this.realtime.invalidate(club.workspaceId, ['organizations'])

        const link = await loadOrgClubLink(this.prisma, organizationId, linkId)
        if (!link) throw new NotFoundError({ message: 'Приглашение не найдено' })
        return serializeOrgClubRow(link, {
            logoUrl: await signClubLogoUrl(this.files, link.club.logoKey),
            metrics: null,
        })
    }
}
