import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { normalizeJoinCode } from '../../domains/workspace/join-code'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
import { WorkspaceInvitationService } from '../../domains/workspace/services/workspace-invitation.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { joinStatusOf } from './join-workspace-utils'
import {
    JoinWorkspaceFeature,
    JoinWorkspaceFeatureResponse,
} from './join-workspace.feature'

@Feature(JoinWorkspaceFeature)
export class JoinWorkspaceHandler
    implements
        IFeatureHandler<JoinWorkspaceFeature, JoinWorkspaceFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly joinRequests: JoinRequestService,
        private readonly audit: AuditService,
        private readonly invitations: WorkspaceInvitationService,
    ) {}

    async execute({ payload, invokerUserId }: JoinWorkspaceFeature) {
        const select = {
            id: true,
            name: true,
            ownerId: true,
            isActive: true,
            joinAutoApprove: true,
        } as const
        let ws: {
            id: string
            name: string
            ownerId: string
            isActive: boolean
            joinAutoApprove: boolean
        } | null = null
        if (payload.workspaceKey) {
            // A branded build's own club, after the person agreed to join.
            // Always a request for an admin: the key is public and permanent.
            const byKey = await this.prisma.workspace.findUnique({
                where: { key: payload.workspaceKey },
                select,
            })
            ws = byKey ? { ...byKey, joinAutoApprove: false } : null
        } else {
            // Malformed, unknown and disabled codes all answer the same, so
            // the response never tells a guesser how close they got.
            const code = normalizeJoinCode(payload.code ?? '')
            const row = code
                ? await this.prisma.workspaceJoinCode.findUnique({
                      where: { code },
                      select: { workspace: { select } },
                  })
                : null
            ws = row?.workspace ?? null
        }
        if (!ws || !ws.isActive) {
            throw new NotFoundError({ message: 'Клуб с таким кодом не найден' })
        }

        // The club already invited this person: entering its code is consent,
        // so the offer is accepted (role and group as the club chose).
        const accepted = await this.invitations.acceptPendingFor(
            invokerUserId,
            ws.id,
        )
        if (accepted) {
            await this.audit.record({
                action: 'member.acceptInvitation',
                targetType: 'member',
                targetId: invokerUserId,
                workspaceId: ws.id,
                actorId: invokerUserId,
                metadata: { via: 'code', role: accepted.roleName },
            })
            return {
                status: 'active' as const,
                created: true,
                workspaceId: ws.id,
                workspaceName: ws.name,
            }
        }
        // Already in (or already asked, or turned down): just say so — such a
        // person is not asked for a name again.
        const existing = await this.joinRequests.findExisting(
            invokerUserId,
            ws,
        )
        // One exception: a request still waiting while the club now accepts
        // without confirmation — requestMembership approves it below.
        const upgradable =
            existing?.kind === 'existing' &&
            existing.status === 'INVITED' &&
            ws.joinAutoApprove
        if (existing && !upgradable) {
            return {
                status: joinStatusOf(existing),
                created: false,
                workspaceId: ws.id,
                workspaceName: ws.name,
            }
        }

        const user = await this.prisma.user.findUnique({
            where: { id: invokerUserId },
            select: { firstname: true, lastname: true },
        })
        if (
            !user?.firstname?.trim() &&
            (!payload.firstname || !payload.lastname)
        ) {
            throw new BadRequestError({
                message:
                    'Укажите имя и фамилию — так клуб поймёт, кто подаёт заявку',
            })
        }

        // Fill blanks only: User is global and bigger than this club, so a
        // name already on it is never overwritten from here.
        const data: { firstname?: string; lastname?: string } = {}
        if (!user?.firstname?.trim() && payload.firstname) {
            data.firstname = payload.firstname
        }
        if (!user?.lastname?.trim() && payload.lastname) {
            data.lastname = payload.lastname
        }
        if (Object.keys(data).length > 0) {
            await this.prisma.user.update({
                where: { id: invokerUserId },
                data,
            })
        }

        const outcome = await this.joinRequests.requestMembership({
            userId: invokerUserId,
            workspace: ws,
            autoApprove: ws.joinAutoApprove,
            audience: 'staff',
        })

        if (outcome.kind === 'created') {
            await this.audit.record({
                action: 'member.joinByCode',
                targetType: 'member',
                targetId: invokerUserId,
                workspaceId: ws.id,
                actorId: invokerUserId,
                metadata: { autoApproved: outcome.status === 'ACTIVE' },
            })
        }

        return {
            status: joinStatusOf(outcome),
            created: outcome.kind === 'created',
            workspaceId: ws.id,
            workspaceName: ws.name,
        }
    }
}
