import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    GetWorkspaceStatsFeature,
    GetWorkspaceStatsFeatureResponse,
} from './get-workspace-stats.feature'

@Feature(GetWorkspaceStatsFeature)
export class GetWorkspaceStatsHandler
    implements
        IFeatureHandler<
            GetWorkspaceStatsFeature,
            GetWorkspaceStatsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId }: GetWorkspaceStatsFeature) {
        const [videos, videosReady, courses, members, recentEventsRaw] =
            await this.prisma.$transaction([
                this.prisma.video.count({ where: { workspaceId } }),
                this.prisma.video.count({
                    where: { workspaceId, status: 'ready' },
                }),
                this.prisma.course.count({ where: { workspaceId } }),
                this.prisma.workspaceMember.count({ where: { workspaceId } }),
                this.prisma.auditEvent.findMany({
                    where: { workspaceId },
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                }),
            ])

        const actorIds = Array.from(
            new Set(
                recentEventsRaw
                    .map((event) => event.actorId)
                    .filter((id): id is string => Boolean(id)),
            ),
        )

        const actors = actorIds.length
            ? await this.prisma.user.findMany({
                  where: { id: { in: actorIds } },
                  select: { id: true, email: true },
              })
            : []

        const actorEmail = new Map(actors.map((u) => [u.id, u.email]))

        return {
            counts: { videos, videosReady, courses, members },
            recentEvents: recentEventsRaw.map((event) => ({
                id: event.id,
                action: event.action,
                targetType: event.targetType,
                targetId: event.targetId,
                actorEmail: event.actorId
                    ? actorEmail.get(event.actorId) ?? null
                    : null,
                createdAt: event.createdAt.toISOString(),
            })),
        }
    }
}
