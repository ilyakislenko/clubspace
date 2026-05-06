import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListWorkspaceEventsFeature,
    ListWorkspaceEventsFeatureResponse,
} from './list-workspace-events.feature'
import { serializeEvent } from './schemas'

const DEFAULT_RANGE_DAYS = 60

@Feature(ListWorkspaceEventsFeature)
export class ListWorkspaceEventsHandler
    implements
        IFeatureHandler<
            ListWorkspaceEventsFeature,
            ListWorkspaceEventsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ payload, workspaceId }: ListWorkspaceEventsFeature) {
        // Defaults: today (UTC midnight) → +60d. The mobile feed has its
        // own pagination model in mind for later, but for now any
        // student-relevant range fits in one call.
        const now = new Date()
        const fromDate = payload.from
            ? new Date(payload.from)
            : new Date(
                  Date.UTC(
                      now.getUTCFullYear(),
                      now.getUTCMonth(),
                      now.getUTCDate(),
                  ),
              )
        const toDate = payload.to
            ? new Date(payload.to)
            : new Date(fromDate.getTime() + DEFAULT_RANGE_DAYS * 86400_000)

        const rows = await this.prisma.workspaceEvent.findMany({
            where: {
                workspaceId,
                // Overlap test: include events that touch the window at all.
                startAt: { lte: toDate },
                endAt: { gte: fromDate },
            },
            orderBy: { startAt: 'asc' },
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

        return { data: rows.map(serializeEvent) }
    }
}
