import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListJournalFeature,
    ListJournalFeatureResponse,
} from './list-journal.feature'
import { serializeEntry } from './schemas'

@Feature(ListJournalFeature)
export class ListJournalHandler
    implements IFeatureHandler<ListJournalFeature, ListJournalFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListJournalFeature) {
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 30
        const where = { workspaceId: f.workspaceId, userId: f.userId }

        const [rows, total] = await Promise.all([
            this.prisma.trainingJournalEntry.findMany({
                where,
                orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
                skip: (curPage - 1) * perPage,
                take: perPage,
            }),
            this.prisma.trainingJournalEntry.count({ where }),
        ])

        return {
            entries: rows.map(serializeEntry),
            total,
            curPage,
            perPage,
        }
    }
}
