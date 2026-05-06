import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { serializeEvent } from './schemas'
import {
    UpdateWorkspaceEventFeature,
    UpdateWorkspaceEventFeatureResponse,
} from './update-workspace-event.feature'

@Feature(UpdateWorkspaceEventFeature)
export class UpdateWorkspaceEventHandler
    implements
        IFeatureHandler<
            UpdateWorkspaceEventFeature,
            UpdateWorkspaceEventFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        eventId,
        invokerUserId,
    }: UpdateWorkspaceEventFeature) {
        const existing = await this.prisma.workspaceEvent.findFirst({
            where: { id: eventId, workspaceId },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Event not found' })
        }

        const startAt = payload.startAt
            ? new Date(payload.startAt)
            : existing.startAt
        const endAt = payload.endAt ? new Date(payload.endAt) : existing.endAt
        if (startAt >= endAt) {
            throw new BadRequestError({
                message: 'startAt must be before endAt',
            })
        }

        if (payload.gymId !== undefined && payload.gymId !== null) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Gym not found' })
        }
        if (payload.coachId !== undefined && payload.coachId !== null) {
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

        const updated = await this.prisma.workspaceEvent.update({
            where: { id: eventId },
            data: {
                ...(payload.title !== undefined && { title: payload.title }),
                ...(payload.description !== undefined && {
                    description: payload.description,
                }),
                ...(payload.link !== undefined && { link: payload.link }),
                ...(payload.startAt !== undefined && { startAt }),
                ...(payload.endAt !== undefined && { endAt }),
                ...(payload.gymId !== undefined && { gymId: payload.gymId }),
                ...(payload.coachId !== undefined && {
                    coachId: payload.coachId,
                }),
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
            action: 'event.update',
            targetType: 'event',
            targetId: eventId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { fields: Object.keys(payload) },
        })

        return serializeEvent(updated)
    }
}
