import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    DeleteJournalEntryFeature,
    DeleteJournalEntryFeatureResponse,
} from './delete-journal-entry.feature'

@Feature(DeleteJournalEntryFeature)
export class DeleteJournalEntryHandler
    implements
        IFeatureHandler<
            DeleteJournalEntryFeature,
            DeleteJournalEntryFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: DeleteJournalEntryFeature) {
        // Scope the delete to the caller's own entry — a member can't delete
        // someone else's (or a non-existent) entry.
        const { count } = await this.prisma.trainingJournalEntry.deleteMany({
            where: {
                id: f.entryId,
                workspaceId: f.workspaceId,
                userId: f.userId,
            },
        })
        if (count === 0) {
            throw new NotFoundError({ message: 'Запись не найдена' })
        }
        return { status: 'deleted' as const }
    }
}
