import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    CreateWorkspaceEventFeature,
    CreateWorkspaceEventFeatureResponse,
} from './create-workspace-event.feature'
import { serializeEvent } from './schemas'

@Feature(CreateWorkspaceEventFeature)
export class CreateWorkspaceEventHandler
    implements
        IFeatureHandler<
            CreateWorkspaceEventFeature,
            CreateWorkspaceEventFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: CreateWorkspaceEventFeature) {
        if (payload.gymId) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Gym not found' })
        }
        if (payload.coachId) {
            const member = await this.prisma.workspaceMember.findFirst({
                where: { userId: payload.coachId, workspaceId },
                select: { userId: true },
            })
            if (!member) {
                throw new NotFoundError({
                    message: 'Coach is not a workspace member',
                })
            }
        }

        // Default coachId to the creator so list views show "by [Coach
        // name]" without the form forcing an explicit pick.
        const coachId = payload.coachId ?? invokerUserId

        const created = await this.prisma.workspaceEvent.create({
            data: {
                workspaceId,
                title: payload.title,
                description: payload.description ?? null,
                link: payload.link ?? null,
                startAt: new Date(payload.startAt),
                endAt: new Date(payload.endAt),
                gymId: payload.gymId ?? null,
                coachId,
                createdById: invokerUserId,
            },
            include: {
                gym: { select: { id: true, name: true, address: true } },
                coach: {
                    select: {
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                    },
                },
            },
        })

        await this.audit.record({
            action: 'event.create',
            targetType: 'event',
            targetId: created.id,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                title: created.title,
                startAt: created.startAt.toISOString(),
                endAt: created.endAt.toISOString(),
                gymId: created.gymId,
                coachId: created.coachId,
            },
        })

        return serializeEvent(created)
    }
}
