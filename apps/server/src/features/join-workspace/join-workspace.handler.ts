import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { normalizeJoinCode } from '../../domains/workspace/join-code'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
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
    ) {}

    async execute({ payload, invokerUserId }: JoinWorkspaceFeature) {
        // Malformed, unknown and disabled codes all answer the same, so the
        // response never tells a guesser how close they got.
        const code = normalizeJoinCode(payload.code)
        const ws = code
            ? await this.prisma.workspace.findUnique({
                  where: { joinCode: code },
                  select: {
                      id: true,
                      name: true,
                      ownerId: true,
                      isActive: true,
                      joinAutoApprove: true,
                  },
              })
            : null
        if (!ws || !ws.isActive) {
            throw new NotFoundError({ message: 'Клуб с таким кодом не найден' })
        }

        // Already in (or already asked, or turned down): just say so — such a
        // person is not asked for a name again.
        const existing = await this.joinRequests.findExisting(
            invokerUserId,
            ws,
        )
        if (existing) {
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
